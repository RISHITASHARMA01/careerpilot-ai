"""Local-first job indexing and semantic search backed by pgvector."""
import math
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings

router = APIRouter(prefix="/api/v1/jobs", tags=["Semantic Jobs"])
EMBED_MODEL = "nomic-embed-text"
DIMENSIONS = 768

class JobIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    company: str = Field(min_length=2, max_length=200)
    location: str = Field(default="Remote", max_length=200)
    description: str = Field(min_length=20, max_length=12000)
    source_url: str | None = Field(default=None, max_length=1000)

class SearchIn(BaseModel):
    query: str = Field(min_length=3, max_length=3000)
    limit: int = Field(default=10, ge=1, le=30)


def valid_vector(values: list[float]) -> list[float]:
    if len(values) != DIMENSIONS or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
        raise ValueError(f"Embedding must contain {DIMENSIONS} finite numbers")
    return [float(x) for x in values]


async def embed(content: str) -> list[float]:
    url = settings.ollama_base_url.rstrip("/") + "/api/embed"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, json={"model": EMBED_MODEL, "input": content, "truncate": True})
            response.raise_for_status()
            data = response.json()
        return valid_vector(data["embeddings"][0])
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=503, detail=f"Local embedding model unavailable or invalid. Check Ollama and pull {EMBED_MODEL}.") from exc


def engine():
    return create_engine(settings.database_url, pool_pre_ping=True)


def init_db() -> None:
    db = engine()
    try:
        with db.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(text("""CREATE TABLE IF NOT EXISTS jobs (
                id UUID PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                company VARCHAR(200) NOT NULL,
                location VARCHAR(200) NOT NULL,
                description TEXT NOT NULL,
                source_url VARCHAR(1000),
                embedding vector(768) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )"""))
            conn.execute(text("CREATE INDEX IF NOT EXISTS jobs_embedding_hnsw_idx ON jobs USING hnsw (embedding vector_cosine_ops)"))
    finally:
        db.dispose()


@router.post("", status_code=201)
async def add_job(job: JobIn):
    vector = await embed(f"{job.title}\n{job.company}\n{job.description}")
    job_id = str(uuid.uuid4())
    db = engine()
    try:
        with db.begin() as conn:
            conn.execute(text("""INSERT INTO jobs (id, title, company, location, description, source_url, embedding)
                VALUES (:id, :title, :company, :location, :description, :source_url, CAST(:embedding AS vector))"""),
                {**job.model_dump(), "id": job_id, "embedding": str(vector)})
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable or jobs schema missing. Run database initialization.") from exc
    finally:
        db.dispose()
    return {"id": job_id, "title": job.title, "company": job.company, "embedding_model": EMBED_MODEL}


@router.post("/search")
async def search_jobs(search: SearchIn):
    vector = await embed(search.query)
    db = engine()
    try:
        with db.connect() as conn:
            rows = conn.execute(text("""SELECT id, title, company, location, description, source_url,
                    1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                    FROM jobs ORDER BY embedding <=> CAST(:embedding AS vector) LIMIT :limit"""),
                    {"embedding": str(vector), "limit": search.limit}).mappings().all()
        return {"query": search.query, "results": [
            {"id": str(r["id"]), "title": r["title"], "company": r["company"],
             "location": r["location"], "description": r["description"],
             "source_url": r["source_url"], "similarity": round(float(r["similarity"]), 4)} for r in rows
        ], "model": EMBED_MODEL}
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable or jobs schema missing. Run database initialization.") from exc
    finally:
        db.dispose()


if __name__ == "__main__":
    init_db()
    print("Jobs table and pgvector HNSW index ready")
