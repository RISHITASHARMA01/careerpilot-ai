from app.chat import router as chat_router
from app.recommendations import router as recommendations_router
from app.jobs import router as jobs_router
from app.ai import router as ai_router
from app.resume import router as resume_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings

app = FastAPI(title="CareerPilot AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3002", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "service": "careerpilot-api"}

@app.get("/api/v1/status")
def status():
    try:
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            vector_enabled = conn.execute(text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")).scalar()
        engine.dispose()
        return {"api": "online", "database": "connected", "pgvector": bool(vector_enabled), "ollama_model": settings.ollama_model, "ollama": "not checked"}
    except SQLAlchemyError:
        return {"api": "online", "database": "unavailable", "pgvector": False, "ollama_model": settings.ollama_model, "ollama": "not checked"}

app.include_router(resume_router)

app.include_router(ai_router)

app.include_router(jobs_router)

app.include_router(recommendations_router)

app.include_router(chat_router)
