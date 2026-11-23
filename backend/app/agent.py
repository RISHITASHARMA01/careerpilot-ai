import json
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings

router = APIRouter(prefix="/api/v1/agent", tags=["AI Application Agent"])
logger = logging.getLogger(__name__)


class JobRequest(BaseModel):
    job_description: str = Field(min_length=30, max_length=30000)


class JobAnalysis(BaseModel):
    job_title: str = ""
    seniority: str = "unknown"
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    experience_requirements: list[str] = Field(default_factory=list)
    eligibility_warnings: list[str] = Field(default_factory=list)
    preparation_steps: list[str] = Field(default_factory=list)


@router.post("/analyze-job")
async def analyze_job(request: JobRequest):
    prompt = f"""
You are a careful technical job description analyzer.

Extract only information supported by the supplied job description.
Do not invent qualifications, years of experience, locations or eligibility.
Use empty arrays when information is not stated.
Use "unknown" for unspecified seniority.
If location or work authorization eligibility is unspecified,
mention that it must be verified.

Return ONLY a JSON object with exactly these keys:
{{
  "job_title": "",
  "seniority": "",
  "required_skills": [],
  "preferred_skills": [],
  "responsibilities": [],
  "experience_requirements": [],
  "eligibility_warnings": [],
  "preparation_steps": []
}}

JOB DESCRIPTION:
{request.job_description}
"""

    url = settings.ollama_base_url.rstrip("/") + "/api/chat"

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                url,
                json={
                    "model": settings.ollama_model,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "stream": False,
                    "think": False,
                    "format": "json",
                    "options": {
                        "temperature": 0.1,
                        "num_predict": 1400
                    }
                }
            )
            response.raise_for_status()

        content = response.json().get("message", {}).get("content", "")

        if not content.strip():
            raise ValueError("Ollama returned an empty response")

        parsed = json.loads(content)
        analysis = JobAnalysis.model_validate(parsed)

        return {
            "analysis": analysis.model_dump(),
            "model": settings.ollama_model,
            "note": "AI-generated analysis. Verify all requirements against the original posting."
        }

    except (httpx.HTTPError, ValueError, ValidationError, KeyError, TypeError) as exc:
        logger.warning("Job analysis failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="AI job analysis failed. Check Ollama connectivity and model output."
        ) from exc
