import io
import re
from collections import Counter

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pypdf import PdfReader

router = APIRouter(prefix="/api/v1", tags=["Resume Analysis"])
MAX_BYTES = 5 * 1024 * 1024
SKILLS = [
    "python", "java", "javascript", "typescript", "c++", "react", "node.js", "fastapi",
    "flask", "django", "sql", "postgresql", "mongodb", "docker", "kubernetes",
    "aws", "azure", "git", "linux", "rest api", "ci/cd", "machine learning",
    "deep learning", "nlp", "llm", "rag", "embeddings", "semantic search",
    "vector database", "pgvector", "ollama", "pytorch", "tensorflow", "redis",
    "cybersecurity", "network security", "penetration testing", "owasp", "wireshark",
    "cloudflare", "terraform", "data structures", "algorithms", "testing", "pytest",
]

def detect_skills(text: str) -> list[str]:
    normalized = text.casefold()
    found = []
    for skill in SKILLS:
        # Do not count partial words, e.g. 'java' inside 'javascript'.
        pattern = r"(?<![\w])" + re.escape(skill.casefold()) + r"(?![\w])"
        if re.search(pattern, normalized):
            found.append(skill)
    return found


def analyze_text(resume_text: str, job_description: str) -> dict:
    resume_skills = detect_skills(resume_text)
    job_skills = detect_skills(job_description)
    matched = sorted(set(resume_skills) & set(job_skills))
    missing = sorted(set(job_skills) - set(resume_skills))
    score = round(100 * len(matched) / len(job_skills)) if job_skills else None
    return {
        "resume_skills": resume_skills,
        "job_skills": job_skills,
        "matched_skills": matched,
        "missing_skills": missing,
        "skill_match_percent": score,
        "resume_word_count": len(resume_text.split()),
        "note": "Keyword-based skill coverage, not an official ATS score. Verify skills manually.",
    }


@router.post("/resume/analyze")
async def analyze_resume(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
):
    if not resume.filename or not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF resume.")
    if not job_description.strip():
        raise HTTPException(status_code=400, detail="Enter a job description.")
    if len(job_description) > 30000:
        raise HTTPException(status_code=400, detail="Job description is too long.")
    data = await resume.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="PDF must be 5 MB or smaller.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > 20:
            raise HTTPException(status_code=400, detail="PDF must have 20 pages or fewer.")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Unable to read PDF. Try another PDF.")
    if not text.strip():
        raise HTTPException(status_code=422, detail="No selectable text found. Scanned PDFs need OCR.")
    return analyze_text(text, job_description)
