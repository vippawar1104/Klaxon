# Klaxon — error tracking that collapses volume into signal

<div align="center">

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)

**A thousand crashes. One issue. One alert.**

</div>

Drop the SDK into your app and every crash reports itself. Klaxon fingerprints the stack trace, folds identical failures into a single issue, and sends exactly **one** notification no matter how many events arrive.

---

## Features

- **Catch** — browser/Node SDK hooks `onerror` and `unhandledrejection`, batches events, flushes on tab close via `sendBeacon`, and never throws inside your app
- **Group** — fingerprints in-app stack frames (not line numbers), so an edit above the throw site never splits one bug in two, and Chrome/Firefox traces for the same crash land in one issue
- **Deduplicate** — retried submissions are discarded by client `event_id`, so network flakiness cannot inflate your counts
- **Alert** — new-issue, regression, and volume rules behind a per-issue cooldown — 1,000 crashes produce 1 notification
- **Explain** *(optional)* — Gemini reads the trace and breadcrumbs and suggests a root cause

---

## Architecture

```
SDK ──► Ingest ──► Group ──► Alert
        202 in     fingerprint    cooldown lock
        ~5ms       + upsert       one notification
```

The ingest endpoint returns `202` before doing real work, is rate-limited per project, and stores only a sample of payloads — so a crash loop costs queue depth rather than availability.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | FastAPI + SQLModel (SQLite) |
| **Frontend** | React 19 + Vite + TypeScript + Tailwind CSS |
| **SDK** | Vanilla JS, zero dependencies, no build step |
| **AI** *(optional)* | Google Gemini — stack-trace explanation only |

---

## Quick Start

### Prerequisites

- [Python 3.11+](https://www.python.org/downloads/)
- [Node.js 18+](https://nodejs.org/)
- *(Optional)* [Gemini API key](https://aistudio.google.com/apikey) for AI explain

### 1. Clone the repo

```bash
git clone https://github.com/vippawar1104/Klaxon.git
cd Klaxon
```

### 2. Backend

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # add GEMINI_API_KEY here (optional)
uvicorn backend.main:app --reload
```

Backend runs on **http://localhost:8000**

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **http://localhost:5173**

---

## SDK Integration

### Create a project

```bash
curl -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-app"}'
```

Returns a `public_key` and DSN. Then initialise the SDK:

```js
import * as Klaxon from './sdk/klaxon.js'

Klaxon.init({ dsn: 'http://<public_key>@localhost:8000/<project_id>' })
```

### Generate test crashes

```bash
python scripts/generate_crashes.py --count 1000 --concurrency 16
```

Prints throughput and p50/p95/p99 ingest latency, then shows events collapsing into a handful of issues.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/projects` | Create a project — returns key + DSN |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/{project_id}/store` | Ingest one event → `202` |
| `GET` | `/api/issues?project_id=` | List grouped issues |
| `GET` | `/api/issues/{id}` | Issue detail with trace & breadcrumbs |
| `POST` | `/api/issues/{id}/status` | Resolve / ignore / reopen |
| `POST` | `/api/issues/{id}/explain` | Gemini root-cause analysis |
| `GET` | `/api/alerts?project_id=` | Alerts that have fired |
| `GET` | `/api/alerts/rules?project_id=` | Alert rules |
| `POST` | `/api/alerts/rules/{id}/toggle` | Enable / disable a rule |

---

## Project Structure

```
Klaxon/
├── backend/          # FastAPI app — routes, models, schemas
├── core/             # Business logic — fingerprinting, alerting, ingest, AI
├── frontend/         # React + Vite dashboard
│   └── src/
├── sdk/              # Vanilla JS SDK (klaxon.js)
├── scripts/          # Utility scripts (crash generator, install)
├── requirements.txt
└── .env.example
```

---

## Roadmap

**Implemented:**
- Ingest, grouping, deduplication, sampling
- Rate limiting, alerting with cooldown
- Regression detection
- Project management
- AI-powered stack trace explanation

**Coming soon:**
- Redis queue + background workers (ingest is currently synchronous)
- Hourly rollup buckets for sparklines
- Retention purge
- Source-map support for minified traces
- Webhook & Slack integrations

---

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

## License

MIT
