# CareerPilot AI

Local-first agentic job search and recommendation platform.

## Phase 1: Run on Ubuntu

Requirements: Docker Engine with Compose plugin. Optional: Ollama installed on the host.

```bash
cp .env.example .env
# Edit POSTGRES_PASSWORD and DATABASE_URL together to use the same password.
docker compose up --build -d
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/status
```

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs
- Database: PostgreSQL 16 with pgvector enabled

### Tests

The production backend image intentionally contains only runtime requirements and app code. To run tests locally:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

### Local Ollama

If Ollama is installed on your Ubuntu host:

```bash
ollama serve
# In another terminal, use a model you have installed:
ollama list
```

The backend currently stores the Ollama URL/model setting but does not call the model. Ollama connectivity and tool calling are planned for a later phase. If running Ollama inside Docker or exposing it to containers, configure host binding and firewall deliberately; do not expose it publicly.

### Notes

- This is a local development configuration, **not hardened production deployment**. Bindings use localhost and `.env` is excluded from Git.
- Changing PostgreSQL credentials after first startup does not update an existing database volume; use SQL to rotate credentials or recreate the volume only if you can discard local data.
- Schema changes after Phase 1 should use Alembic migrations; the `init.sql` file only runs when the database volume is first initialized.
- Dependencies use compatible version ranges for bootstrapping. Add lockfiles/pinned versions and CI in the next hardening phase.
- Do not commit real resumes, credentials, or user data.

## Application Screenshots

### Main Dashboard
![CareerPilot AI Dashboard](docs/screenshots/dashboard.png)

### Job Discovery
![Job Discovery](docs/screenshots/job-discovery.png)

### Application Tracking
![Application Tracker](docs/screenshots/application-tracker.png)

### Interview Management
![Interview Dashboard](docs/screenshots/interview-dashboard.png)

### Application Analytics
![Application Analytics](docs/screenshots/analytics.png)
