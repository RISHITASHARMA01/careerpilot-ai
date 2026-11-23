"""Phase 4A: manual Remotive job import, with deduplication and attribution."""
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.jobs import embed, engine

router = APIRouter(prefix="/api/v1/discovery", tags=["Job Discovery"])
REMOTIVE = "https://remotive.com/api/remote-jobs"

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

def clean_html(value):
    parser = PlainText()
    parser.feed(value or "")
    return re.sub(r"\s+", " ", unescape(" ".join(parser.parts))).strip()

def ensure_schema(conn):
    conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source VARCHAR(50)"))
    conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id VARCHAR(100)"))
    conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ"))
    conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_external_uidx ON jobs (source, external_id)"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_url_uidx ON jobs (source_url) WHERE source_url IS NOT NULL"))

@router.post("/import/remotive")
async def import_remotive(search: str = Query(default="", max_length=100), limit: int = Query(default=10, ge=1, le=30)):
    # Operator-triggered import only; do not poll more than Remotive permits.
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, trust_env=False) as client:
            response = await client.get(REMOTIVE, params={"search": search, "limit": limit})
            response.raise_for_status()
            data = response.json()
        records = data.get("jobs", [])
        if not isinstance(records, list):
            raise ValueError("Invalid jobs payload")
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, "Remotive job feed unavailable") from exc

    db = engine()
    imported = 0
    updated = 0
    skipped = 0
    try:
        with db.begin() as conn:
            ensure_schema(conn)
        for item in records[:limit]:
            if not isinstance(item, dict):
                skipped += 1
                continue
            external_id = str(item.get("id", ""))[:100]
            title = str(item.get("title") or "").strip()[:200]
            company = str(item.get("company_name") or "").strip()[:200]
            source_url = str(item.get("url") or "")[:1000]
            parsed = urlparse(source_url)
            if not (external_id and title and company and parsed.scheme == "https" and parsed.hostname in ("remotive.com", "www.remotive.com")):
                skipped += 1
                continue
            description = clean_html(str(item.get("description") or ""))[:12000]
            if len(description) < 20:
                skipped += 1
                continue
            location = str(item.get("candidate_required_location") or "Remote")[:200]
            with db.connect() as conn:
                exists = conn.execute(text("SELECT id FROM jobs WHERE source = 'Remotive' AND external_id = :external_id"), {"external_id": external_id}).first()
            if exists:
                with db.begin() as conn:
                    conn.execute(text("UPDATE jobs SET last_seen_at = now() WHERE source = 'Remotive' AND external_id = :external_id"), {"external_id": external_id})
                updated += 1
                continue
            vector = await embed(f"{title}\n{company}\n{description}")
            with db.begin() as conn:
                result = conn.execute(text("""INSERT INTO jobs
                    (id, title, company, location, description, source_url, embedding, source, external_id, published_at, last_seen_at)
                    VALUES (gen_random_uuid(), :title, :company, :location, :description, :source_url,
                        CAST(:embedding AS vector), 'Remotive', :external_id,
                        CAST(:published_at AS timestamptz), now())
                    ON CONFLICT DO NOTHING RETURNING id"""), {
                    "title": title, "company": company, "location": location,
                    "description": description, "source_url": source_url,
                    "embedding": str(vector), "external_id": external_id,
                    "published_at": item.get("publication_date") or None,
                }).first()
                if result:
                    imported += 1
                else:
                    skipped += 1
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Job database unavailable or migration failed") from exc
    finally:
        db.dispose()
    return {"source": "Remotive", "imported": imported, "already_indexed": updated,
            "skipped": skipped, "fetched": min(len(records), limit),
            "note": "Jobs may be delayed; credit Remotive and link to the original listing."}

@router.get("/jobs")
def discovered_jobs(limit: int = Query(default=20, ge=1, le=100)):
    db = engine()
    try:
        with db.connect() as conn:
            rows = conn.execute(text("""SELECT id, title, company, location, source_url, source,
                published_at, last_seen_at FROM jobs WHERE source IN ('Remotive', 'Arbeitnow')
                ORDER BY published_at DESC NULLS LAST LIMIT :limit"""), {"limit": limit}).mappings().all()
        return {"jobs": [{**dict(r), "id": str(r["id"]),
                           "published_at": r["published_at"].isoformat() if r["published_at"] else None,
                           "last_seen_at": r["last_seen_at"].isoformat() if r["last_seen_at"] else None} for r in rows]}
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Job database unavailable or migration missing") from exc
    finally:
        db.dispose()


ARBEITNOW = "https://www.arbeitnow.com/api/job-board-api"

@router.post("/import/arbeitnow")
async def import_arbeitnow(
    search: str = Query(default="", max_length=100),
    limit: int = Query(default=10, ge=1, le=30),
    page: int = Query(default=1, ge=1, le=10),
):
    """Manually import relevant public Arbeitnow listings; geography is not assumed."""
    try:
        async with httpx.AsyncClient(timeout=35, follow_redirects=True, trust_env=False) as client:
            response = await client.get(ARBEITNOW, params={"page": page})
            response.raise_for_status()
            payload = response.json()
        records = payload.get("data", [])
        if not isinstance(records, list):
            raise ValueError("Invalid job feed")
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, "Arbeitnow job feed unavailable") from exc

    # Search in title first, so generic keywords in lengthy descriptions do not
    # cause unrelated jobs to be indexed. No match is not a feed failure.
    terms = [term.casefold() for term in search.split() if term.strip()]
    matching = [item for item in records if isinstance(item, dict) and
                all(term in str(item.get("title") or "").casefold() for term in terms)]
    imported = updated = skipped = 0
    db = engine()
    try:
        with db.begin() as conn:
            ensure_schema(conn)
        for item in matching[:limit]:
            external_id = str(item.get("slug") or "")[:100]
            title = str(item.get("title") or "").strip()[:200]
            company = str(item.get("company_name") or "").strip()[:200]
            source_url = str(item.get("url") or "")[:1000]
            parsed = urlparse(source_url)
            if not (external_id and title and company and parsed.scheme == "https" and
                    parsed.hostname in ("arbeitnow.com", "www.arbeitnow.com")):
                skipped += 1
                continue
            description = clean_html(str(item.get("description") or ""))[:12000]
            if len(description) < 20:
                skipped += 1
                continue
            location = str(item.get("location") or "Unspecified")[:200]
            with db.connect() as conn:
                exists = conn.execute(text("SELECT id FROM jobs WHERE source = 'Arbeitnow' AND external_id = :external_id"),
                                      {"external_id": external_id}).first()
            if exists:
                with db.begin() as conn:
                    conn.execute(text("UPDATE jobs SET last_seen_at = now() WHERE source = 'Arbeitnow' AND external_id = :external_id"),
                                 {"external_id": external_id})
                updated += 1
                continue
            vector = await embed(f"{title}\n{company}\n{description}")
            with db.begin() as conn:
                result = conn.execute(text("""INSERT INTO jobs
                    (id, title, company, location, description, source_url, embedding,
                     source, external_id, published_at, last_seen_at)
                    VALUES (gen_random_uuid(), :title, :company, :location, :description,
                     :source_url, CAST(:embedding AS vector), 'Arbeitnow', :external_id,
                     to_timestamp(:published_at), now())
                    ON CONFLICT DO NOTHING RETURNING id"""), {
                        "title": title, "company": company, "location": location,
                        "description": description, "source_url": source_url,
                        "embedding": str(vector), "external_id": external_id,
                        "published_at": int(item.get("created_at") or 0),
                    }).first()
            if result:
                imported += 1
            else:
                skipped += 1
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Job database unavailable or migration failed") from exc
    finally:
        db.dispose()
    return {"source": "Arbeitnow", "imported": imported,
            "already_indexed": updated, "skipped": skipped,
            "fetched": len(records), "matching_titles": len(matching),
            "note": "Public feed; not India-specific. Check each employer's location and eligibility rules."}
