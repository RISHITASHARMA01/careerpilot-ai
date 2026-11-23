from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings

app = FastAPI(title="CareerPilot AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
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
