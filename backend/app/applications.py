from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.jobs import engine

router = APIRouter(
    prefix="/api/v1/applications",
    tags=["Application Workspace"]
)

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS application_drafts (
    id UUID PRIMARY KEY,
    company TEXT NOT NULL,
    job_title TEXT NOT NULL,
    job_url TEXT NOT NULL DEFAULT '',
    cover_letter TEXT NOT NULL DEFAULT '',
    question_answers TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
)
"""


class ApplicationCreate(BaseModel):
    company: str = Field(min_length=1, max_length=150)
    job_title: str = Field(min_length=1, max_length=200)
    job_url: str = Field(default="", max_length=2000)
    cover_letter: str = Field(default="", max_length=10000)
    question_answers: str = Field(default="", max_length=10000)


class ApplicationEdit(BaseModel):
    cover_letter: str = Field(max_length=10000)
    question_answers: str = Field(max_length=10000)


def database():
    return engine()


def ensure_table(conn):
    conn.execute(text(CREATE_TABLE))


def valid_id(application_id: str):
    try:
        return str(UUID(application_id))
    except ValueError:
        raise HTTPException(400, "Invalid application ID.")


@router.post("", status_code=201)
def create_application(payload: ApplicationCreate):
    db = database()
    application_id = str(uuid4())
    now = datetime.now(timezone.utc)

    try:
        with db.begin() as conn:
            ensure_table(conn)
            conn.execute(
                text("""
                    INSERT INTO application_drafts
                    (id, company, job_title, job_url,
                     cover_letter, question_answers,
                     status, created_at, updated_at)
                    VALUES
                    (:id, :company, :job_title, :job_url,
                     :cover_letter, :question_answers,
                     'draft', :now, :now)
                """),
                {
                    "id": application_id,
                    **payload.model_dump(),
                    "now": now
                }
            )
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Database unavailable.") from exc
    finally:
        db.dispose()

    return {
        "id": application_id,
        "status": "draft",
        "requires_approval": True
    }


@router.get("")
def list_applications():
    db = database()

    try:
        with db.begin() as conn:
            ensure_table(conn)
            rows = conn.execute(text("""
                SELECT id, company, job_title, job_url,
                       cover_letter, question_answers,
                       status, created_at, updated_at
                FROM application_drafts
                ORDER BY created_at DESC
                LIMIT 100
            """)).mappings().all()

            return {
                "applications": [
                    {**dict(row), "id": str(row["id"])}
                    for row in rows
                ]
            }
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Database unavailable.") from exc
    finally:
        db.dispose()


@router.put("/{application_id}")
def edit_application(
    application_id: str,
    payload: ApplicationEdit
):
    application_id = valid_id(application_id)
    db = database()

    try:
        with db.begin() as conn:
            ensure_table(conn)
            result = conn.execute(text("""
                UPDATE application_drafts
                SET cover_letter = :cover_letter,
                    question_answers = :question_answers,
                    status = 'draft',
                    updated_at = :now
                WHERE id = :id
                  AND status IN ('draft', 'approved')
            """), {
                "id": application_id,
                **payload.model_dump(),
                "now": datetime.now(timezone.utc)
            })

            if result.rowcount == 0:
                raise HTTPException(
                    404, "Editable application not found."
                )
    finally:
        db.dispose()

    return {
        "id": application_id,
        "status": "draft",
        "message": "Changes saved. Approval is required again."
    }


@router.post("/{application_id}/approve")
def approve_application(application_id: str):
    application_id = valid_id(application_id)
    db = database()

    try:
        with db.begin() as conn:
            ensure_table(conn)
            result = conn.execute(text("""
                UPDATE application_drafts
                SET status = 'approved',
                    updated_at = :now
                WHERE id = :id
                  AND status = 'draft'
                  AND (
                    LENGTH(TRIM(cover_letter)) > 0
                    OR LENGTH(TRIM(question_answers)) > 0
                  )
            """), {
                "id": application_id,
                "now": datetime.now(timezone.utc)
            })

            if result.rowcount == 0:
                raise HTTPException(
                    409,
                    "Application not found, already approved, "
                    "or has no content to approve."
                )
    finally:
        db.dispose()

    return {
        "id": application_id,
        "status": "approved",
        "submitted": False,
        "message": "Approved for manual submission."
    }


# Phase 6A: Application Status Tracking

from typing import Literal


class StatusUpdate(BaseModel):
    status: Literal[
        "applied",
        "interview",
        "offer",
        "rejected",
        "withdrawn"
    ]
    note: str = Field(default="", max_length=1000)


def ensure_status_history(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS application_status_history (
            id UUID PRIMARY KEY,
            application_id UUID NOT NULL
                REFERENCES application_drafts(id) ON DELETE CASCADE,
            old_status TEXT NOT NULL,
            new_status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            changed_at TIMESTAMPTZ NOT NULL
        )
    """))


ALLOWED_TRANSITIONS = {
    "approved": {"applied", "withdrawn"},
    "applied": {"interview", "offer", "rejected", "withdrawn"},
    "interview": {"offer", "rejected", "withdrawn", "applied"},
    "offer": {"withdrawn", "rejected"},
    "rejected": set(),
    "withdrawn": set(),
}


@router.patch("/{application_id}/status")
def update_application_status(
    application_id: str,
    payload: StatusUpdate
):
    application_id = valid_id(application_id)
    db = database()

    try:
        with db.begin() as conn:
            ensure_table(conn)
            ensure_status_history(conn)

            row = conn.execute(text("""
                SELECT status
                FROM application_drafts
                WHERE id = :id
                FOR UPDATE
            """), {"id": application_id}).mappings().first()

            if not row:
                raise HTTPException(404, "Application not found.")

            old_status = row["status"]

            if payload.status not in ALLOWED_TRANSITIONS.get(
                old_status, set()
            ):
                raise HTTPException(
                    409,
                    f"Cannot change status from "
                    f"{old_status} to {payload.status}."
                )

            now = datetime.now(timezone.utc)

            conn.execute(text("""
                UPDATE application_drafts
                SET status = :status,
                    updated_at = :now
                WHERE id = :id
            """), {
                "id": application_id,
                "status": payload.status,
                "now": now
            })

            conn.execute(text("""
                INSERT INTO application_status_history
                (id, application_id, old_status,
                 new_status, note, changed_at)
                VALUES
                (:event_id, :application_id, :old_status,
                 :new_status, :note, :now)
            """), {
                "event_id": str(uuid4()),
                "application_id": application_id,
                "old_status": old_status,
                "new_status": payload.status,
                "note": payload.note,
                "now": now
            })

        return {
            "id": application_id,
            "previous_status": old_status,
            "status": payload.status,
            "note": payload.note,
            "updated_at": now.isoformat(),
            "submitted_automatically": False
        }

    except SQLAlchemyError as exc:
        raise HTTPException(
            503, "Database operation failed."
        ) from exc
    finally:
        db.dispose()


@router.get("/{application_id}/history")
def get_application_history(application_id: str):
    application_id = valid_id(application_id)
    db = database()

    try:
        with db.begin() as conn:
            ensure_table(conn)
            ensure_status_history(conn)

            exists = conn.execute(text("""
                SELECT 1 FROM application_drafts
                WHERE id = :id
            """), {"id": application_id}).first()

            if not exists:
                raise HTTPException(404, "Application not found.")

            rows = conn.execute(text("""
                SELECT id, old_status, new_status,
                       note, changed_at
                FROM application_status_history
                WHERE application_id = :id
                ORDER BY changed_at ASC
            """), {"id": application_id}).mappings().all()

        return {
            "application_id": application_id,
            "history": [
                {
                    **dict(row),
                    "id": str(row["id"])
                }
                for row in rows
            ]
        }

    except SQLAlchemyError as exc:
        raise HTTPException(
            503, "Database operation failed."
        ) from exc
    finally:
        db.dispose()
