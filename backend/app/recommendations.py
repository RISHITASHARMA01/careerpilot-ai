"""Resume-based job recommendations with explainable, conservative eligibility filtering."""
import io
import re
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.jobs import embed, engine, EMBED_MODEL
from app.resume import detect_skills, MAX_BYTES

router = APIRouter(prefix='/api/v1', tags=['Recommendations'])

ROLE = re.compile(r'\b(?:software|developer|engineer|programmer|backend|back.end|front.end|full.stack|security|cyber|devops|cloud|data|machine learning|ml engineer|ai engineer|sre|qa|test automation|penetration tester|soc analyst)\b', re.I)
UNRELATED = re.compile(r'\b(?:office assistant|content creator|content reviewer|bookkeeper|sales representative|customer support|video editor|marketing specialist)\b', re.I)
SENIOR_TITLE = re.compile(r'\b(?:senior|sr\.?|staff|principal|lead|head|director|architect|manager)\b', re.I)
JUNIOR_TITLE = re.compile(r'\b(?:intern|internship|junior|entry.level|graduate|fresher|trainee|associate)\b', re.I)
YEARS_REQUIRED = re.compile(r'\b(?:at least|minimum(?: of)?|requires?|with|have|need(?:s)?)?\s*(\d{1,2})\s*\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:commercial|professional|relevant|industry|work)?\s*experience\b', re.I)


def rank_job(similarity: float, resume_skills: list[str], description: str) -> dict:
    job_skills = detect_skills(description)
    matched = sorted(set(resume_skills) & set(job_skills))
    missing = sorted(set(job_skills) - set(resume_skills))
    coverage = len(matched) / len(job_skills) if job_skills else None
    score = similarity if coverage is None else 0.75 * similarity + 0.25 * coverage
    return {'match_score': round(max(0, min(1, score)) * 100, 1),
            'semantic_similarity': round(similarity, 4),
            'skill_coverage_percent': round(coverage * 100, 1) if coverage is not None else None,
            'matched_skills': matched, 'missing_skills': missing}


def assess_job(title: str, description: str, location: str, entry_level_only: bool,
               india_compatible_only: bool, technical_roles_only: bool) -> dict:
    """Conservative heuristics; unknown eligibility remains unknown, not eligible."""
    reasons = []
    eligible = True
    title = title or ''
    description = description or ''
    location = location or ''
    is_technical = bool(ROLE.search(title)) and not bool(UNRELATED.search(title))
    if technical_roles_only and not is_technical:
        eligible = False
        reasons.append('Job title is outside selected technical career paths')

    senior = bool(SENIOR_TITLE.search(title))
    junior = bool(JUNIOR_TITLE.search(title))
    required_years = [int(x) for x in YEARS_REQUIRED.findall(description[:4000]) if int(x) <= 15]
    min_years = max(required_years) if required_years else None
    if entry_level_only and (senior or (min_years is not None and min_years >= 3)):
        eligible = False
        reasons.append('Senior role or 3+ years of experience required')
    elif junior:
        reasons.append('Title suggests an entry-level opportunity')
    elif entry_level_only:
        reasons.append('Experience eligibility not verified')

    loc = location.lower()
    description_lower = description.lower()
    india_explicit = bool(re.search(r'\b(india|indian|bengaluru|bangalore|hyderabad|pune|mumbai|delhi)\b', loc))
    global_explicit = bool(re.search(r'\b(worldwide|anywhere in the world|global remote)\b', loc))
    geography_broad = bool(re.search(r'\b(apac|asia|remote|global)\b', loc))
    foreign_only = bool(re.search(r'\b(usa|u\.s\.|united states|canada|europe|latam|uk|united kingdom|germany)\b', loc))
    explicit_restriction = bool(re.search(
        r'\b(?:must (?:be|reside|live|work) in|residency in|authorized to work in|legal authorization to work in)\s+(?:the\s+)?(?:usa|u\.s\.|united states|canada|uk|united kingdom|germany)\b',
        description_lower[:6000]))
    if explicit_restriction:
        location_status = 'restricted'
    elif india_explicit or global_explicit:
        location_status = 'compatible'
    elif foreign_only and not geography_broad:
        location_status = 'restricted_or_unknown'
    else:
        location_status = 'unknown'
    if india_compatible_only and location_status != 'compatible':
        eligible = False
        reasons.append('India eligibility is not confirmed by listing location')
    elif location_status == 'compatible':
        reasons.append('Listing location suggests India compatibility; verify work authorization and employer requirements')
    elif location_status == 'unknown':
        reasons.append('Location eligibility requires manual verification')

    return {'eligible_under_filters': eligible, 'role_relevant': is_technical,
            'experience_requirement_years': min_years, 'location_eligibility': location_status,
            'eligibility_reasons': reasons}


@router.post('/jobs/recommend')
async def recommend_jobs(resume: UploadFile = File(...), limit: int = Form(10),
                         entry_level_only: bool = Form(False),
                         india_compatible_only: bool = Form(False),
                         technical_roles_only: bool = Form(False)):
    if not 1 <= limit <= 30:
        raise HTTPException(400, 'Limit must be between 1 and 30.')
    if not resume.filename or not resume.filename.lower().endswith('.pdf'):
        raise HTTPException(400, 'Upload a PDF resume.')
    data = await resume.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, 'PDF must be 5 MB or smaller.')
    if not data.startswith(b'%PDF-'):
        raise HTTPException(400, 'Invalid PDF.')
    try:
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > 20:
            raise HTTPException(400, 'PDF must have 20 pages or fewer.')
        resume_text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, 'Unable to read PDF.') from exc
    if not resume_text.strip():
        raise HTTPException(422, 'No selectable text found in PDF.')
    vector = await embed(resume_text[:6000])
    db = engine()
    try:
        with db.connect() as conn:
            rows = conn.execute(text('''SELECT id, title, company, location, description, source_url,
                1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                FROM jobs ORDER BY embedding <=> CAST(:embedding AS vector) LIMIT :candidate_limit'''),
                {'embedding': str(vector), 'candidate_limit': min(150, max(30, limit * 5))}).mappings().all()
    except SQLAlchemyError as exc:
        raise HTTPException(503, 'Jobs database unavailable. Initialize the jobs table.') from exc
    finally:
        db.dispose()
    resume_skills = detect_skills(resume_text)
    recommendations = []
    filtered_out = 0
    for r in rows:
        assessment = assess_job(r['title'], r['description'], r['location'],
                                entry_level_only, india_compatible_only, technical_roles_only)
        if not assessment['eligible_under_filters']:
            filtered_out += 1
            continue
        score = rank_job(float(r['similarity']), resume_skills, r['description'])
        # Explicitly separate the old heuristic match from new relevance ranking.
        bonus = 5 if assessment['role_relevant'] else -15
        if JUNIOR_TITLE.search(r['title'] or ''):
            bonus += 5
        if SENIOR_TITLE.search(r['title'] or ''):
            bonus -= 15
        ranking_score = round(max(0, min(100, score['match_score'] + bonus)), 1)
        recommendations.append({**{k: str(r[k]) if k == 'id' else r[k]
                                   for k in ('id', 'title', 'company', 'location', 'description', 'source_url')},
                                **score, **assessment, 'ranking_score': ranking_score})
    recommendations.sort(key=lambda r: r['ranking_score'], reverse=True)
    return {'resume_skills': resume_skills, 'results': recommendations[:limit],
            'total_candidates': len(rows), 'filtered_out': filtered_out,
            'embedding_model': EMBED_MODEL,
            'filters': {'entry_level_only': entry_level_only,
                        'india_compatible_only': india_compatible_only,
                        'technical_roles_only': technical_roles_only},
            'note': 'Heuristic relevance only; experience/location checks may miss requirements. Not an ATS score, verified eligibility, or hiring probability.'}
