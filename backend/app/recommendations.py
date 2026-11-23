"""Resume-based recommendations over the existing pgvector jobs index."""
import io
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.jobs import embed, engine, EMBED_MODEL
from app.resume import detect_skills, MAX_BYTES

router = APIRouter(prefix='/api/v1', tags=['Recommendations'])


def rank_job(similarity: float, resume_skills: list[str], description: str) -> dict:
    job_skills = detect_skills(description)
    matched = sorted(set(resume_skills) & set(job_skills))
    missing = sorted(set(job_skills) - set(resume_skills))
    coverage = len(matched) / len(job_skills) if job_skills else None
    # 75% semantic similarity + 25% skill coverage when skills are detectable.
    score = similarity if coverage is None else 0.75 * similarity + 0.25 * coverage
    return {'match_score': round(max(0, min(1, score)) * 100, 1),
            'semantic_similarity': round(similarity, 4),
            'skill_coverage_percent': round(coverage * 100, 1) if coverage is not None else None,
            'matched_skills': matched, 'missing_skills': missing}


@router.post('/jobs/recommend')
async def recommend_jobs(resume: UploadFile = File(...), limit: int = Form(10)):
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
    # Truncate for embedding model context; preserve original for skill detection.
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
    for r in rows:
        score = rank_job(float(r['similarity']), resume_skills, r['description'])
        recommendations.append({**{k: str(r[k]) if k == 'id' else r[k]
                                   for k in ('id', 'title', 'company', 'location', 'description', 'source_url')}, **score})
    recommendations.sort(key=lambda r: r['match_score'], reverse=True)
    return {'resume_skills': resume_skills, 'results': recommendations[:limit],
            'total_candidates': len(rows), 'embedding_model': EMBED_MODEL,
            'note': 'Heuristic ranking: 75% semantic similarity and 25% detected skill coverage. Not an ATS or hiring probability.'}
