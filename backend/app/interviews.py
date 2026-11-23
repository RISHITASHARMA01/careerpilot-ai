from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.jobs import engine

router = APIRouter(prefix="/api/v1/interviews", tags=["Interviews"])

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS interviews (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL
        REFERENCES application_drafts(id) ON DELETE CASCADE,
    interview_type TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    meeting_link TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

InterviewType = Literal[
    "hr", "technical", "coding", "managerial", "other"
]

InterviewStatus = Literal[
    "scheduled", "completed", "cancelled"
]


class InterviewCreate(BaseModel):
    application_id: UUID
    interview_type: InterviewType
    scheduled_at: datetime
    duration_minutes: int = Field(default=60, ge=15, le=480)
    meeting_link: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=5000)


class InterviewUpdate(BaseModel):
    status: InterviewStatus
    notes: str = Field(default="", max_length=5000)


def serialize(row):
    data = dict(row)
    data["id"] = str(data["id"])
    data["application_id"] = str(data["application_id"])
    return data


def validate_datetime(value: datetime):
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(
            422,
            "scheduled_at must include a timezone offset."
        )
    return value.astimezone(timezone.utc)


@router.post("", status_code=201)
def schedule_interview(payload: InterviewCreate):
    scheduled_at = validate_datetime(payload.scheduled_at)

    if scheduled_at <= datetime.now(timezone.utc):
        raise HTTPException(
            422, "Interview must be scheduled in the future."
        )

    db = engine()
    interview_id = str(uuid4())

    try:
        with db.begin() as conn:
            conn.execute(text(CREATE_TABLE))

            application = conn.execute(text("""
                SELECT status FROM application_drafts
                WHERE id = :id
            """), {
                "id": str(payload.application_id)
            }).mappings().first()

            if not application:
                raise HTTPException(404, "Application not found.")

            if application["status"] not in ("applied", "interview"):
                raise HTTPException(
                    409,
                    "Application must be applied or in interview stage."
                )

            conn.execute(text("""
                INSERT INTO interviews (
                    id, application_id, interview_type,
                    scheduled_at, duration_minutes,
                    meeting_link, notes
                )
                VALUES (
                    :id, :application_id, :interview_type,
                    :scheduled_at, :duration_minutes,
                    :meeting_link, :notes
                )
            """), {
                "id": interview_id,
                "application_id": str(payload.application_id),
                "interview_type": payload.interview_type,
                "scheduled_at": scheduled_at,
                "duration_minutes": payload.duration_minutes,
                "meeting_link": payload.meeting_link,
                "notes": payload.notes
            })

        return {
            "id": interview_id,
            "application_id": str(payload.application_id),
            "status": "scheduled",
            "scheduled_at": scheduled_at.isoformat(),
            "message": "Interview scheduled successfully."
        }

    except SQLAlchemyError as exc:
        raise HTTPException(
            503, "Database operation failed."
        ) from exc
    finally:
        db.dispose()


@router.get("")
def list_interviews():
    db = engine()

    try:
        with db.begin() as conn:
            conn.execute(text(CREATE_TABLE))

            rows = conn.execute(text("""
                SELECT
                    i.*,
                    a.company,
                    a.job_title
                FROM interviews i
                JOIN application_drafts a
                  ON a.id = i.application_id
                ORDER BY i.scheduled_at ASC
                LIMIT 200
            """)).mappings().all()

        return {
            "interviews": [serialize(row) for row in rows]
        }

    except SQLAlchemyError as exc:
        raise HTTPException(
            503, "Database operation failed."
        ) from exc
    finally:
        db.dispose()


@router.patch("/{interview_id}")
def update_interview(
    interview_id: UUID,
    payload: InterviewUpdate
):
    db = engine()

    try:
        with db.begin() as conn:
            conn.execute(text(CREATE_TABLE))

            result = conn.execute(text("""
                UPDATE interviews
                SET status = :status,
                    notes = :notes,
                    updated_at = NOW()
                WHERE id = :id
                RETURNING id
            """), {
                "id": str(interview_id),
                "status": payload.status,
                "notes": payload.notes
            }).first()

            if not result:
                raise HTTPException(404, "Interview not found.")

        return {
            "id": str(interview_id),
            "status": payload.status,
            "message": "Interview updated successfully."
        }

    except SQLAlchemyError as exc:
        raise HTTPException(
            503, "Database operation failed."
        ) from exc
    finally:
        db.dispose()
