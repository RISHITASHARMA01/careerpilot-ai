import io
import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pypdf import PdfReader

from app.agent import JobRequest, analyze_job
from app.resume import MAX_BYTES

router = APIRouter(prefix="/api/v1/agent", tags=["AI Application Agent"])


def skill_in_text(skill: str, text: str) -> bool:
    """Conservative skill detection with a few common aliases."""
    aliases = {
        "rest apis": ["rest api", "restful api", "restful services"],
        "node.js": ["node.js", "nodejs"],
        "postgresql": ["postgresql", "postgres"],
        "javascript": ["javascript"],
        "ci/cd": ["ci/cd", "continuous integration"],
        "llms": ["llm", "large language model"],
    }

    terms = aliases.get(skill.casefold(), [skill])
    for term in terms:
        pattern = r"(?<!\w)" + re.escape(term) + r"(?!\w)"
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def compare_skills(skills: list[str], resume_text: str):
    found = []
    missing = []

    for skill in skills:
        if skill_in_text(skill, resume_text):
            found.append(skill)
        else:
            missing.append(skill)

    return found, missing


@router.post("/analyze-fit")
async def analyze_fit(
    resume: UploadFile = File(...),
    job_description: str = Form(...)
):
    if not resume.filename or not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Upload a PDF resume.")

    if not 30 <= len(job_description.strip()) <= 30000:
        raise HTTPException(400, "Job description must contain 30–30000 characters.")

    data = await resume.read(MAX_BYTES + 1)

    if len(data) > MAX_BYTES:
        raise HTTPException(413, "PDF must be 5 MB or smaller.")

    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "Invalid PDF file.")

    try:
        reader = PdfReader(io.BytesIO(data))

        if len(reader.pages) > 20:
            raise HTTPException(400, "PDF must have 20 pages or fewer.")

        resume_text = "\n".join(
            page.extract_text() or "" for page in reader.pages
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "Unable to read PDF.") from exc

    if not resume_text.strip():
        raise HTTPException(
            422, "No selectable text found in PDF."
        )

    # Reuse the existing Phase 5A Ollama analyzer.
    job_result = await analyze_job(
        JobRequest(job_description=job_description)
    )

    analysis = job_result["analysis"]

    required = analysis["required_skills"]
    preferred = analysis["preferred_skills"]

    required_found, required_missing = compare_skills(
        required, resume_text
    )

    preferred_found, preferred_missing = compare_skills(
        preferred, resume_text
    )

    coverage = (
        round(len(required_found) * 100 / len(required), 1)
        if required else None
    )

    recommendations = []

    if required_missing:
        recommendations.append(
            "Review required skills not detected in your resume. "
            "Add them only if you have genuine experience."
        )

    if preferred_missing:
        recommendations.append(
            "Consider learning or demonstrating the preferred skills "
            "not detected in your resume."
        )

    if analysis["experience_requirements"]:
        recommendations.append(
            "Compare the stated experience requirements with your "
            "actual work, internship and project experience."
        )

    if not recommendations:
        recommendations.append(
            "Review the job responsibilities and highlight relevant "
            "experience already supported by your resume."
        )

    return {
        "job_title": analysis["job_title"],
        "seniority": analysis["seniority"],
        "match": {
            "required_skills_found": required_found,
            "required_skills_missing": required_missing,
            "preferred_skills_found": preferred_found,
            "preferred_skills_missing": preferred_missing,
            "required_skill_coverage_percent": coverage,
        },
        "experience_requirements": analysis["experience_requirements"],
        "experience_gaps": [
            "Experience requirements require manual verification against the resume."
        ] if analysis["experience_requirements"] else [],
        "eligibility_questions": analysis["eligibility_warnings"],
        "recommendations": recommendations,
        "model": job_result["model"],
        "note": (
            "Skill coverage is based on extracted resume text, not an ATS score "
            "or hiring probability. Missing keywords do not prove missing skills. "
            "Experience and eligibility are not automatically verified."
        ),
    }
