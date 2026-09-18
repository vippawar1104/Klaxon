# 🔔 Klaxon — error tracking that collapses volume into signal

<div align="center">

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)

**A thousand crashes. One issue. One alert.**

</div>

Drop an SDK into your app and every crash reports itself. Klaxon fingerprints
the stack trace, folds identical failures into a single issue, and sends
exactly one notification no matter how many events arrive.

## ✨ What it does

- **Catch** — browser/Node SDK hooks `onerror` and `unhandledrejection`, batches
  events, flushes on tab close via `sendBeacon`, and never throws inside your app
- **Group** — fingerprints the in-app stack frames (not line numbers), so an edit
  above the throw site never splits one bug in two, and Chrome and Firefox traces
  for the same crash land in one issue
- **Deduplicate** — a retried submission is discarded by client `event_id`, so
  network flakiness cannot inflate your counts
- **Alert** — new-issue, regression and volume rules behind a per-issue cooldown:
  1,000 crashes produce 1 notification
- **Explain** *(optional)* — Gemini reads the trace and breadcrumbs and suggests a
  root cause

## 🏗️ How it works

```
SDK ──► Ingest ──► Group ──► Alert
        202 in     fingerprint    cooldown lock
        ~5ms       + upsert       one notification
```

The ingest endpoint returns `202` before doing real work, is rate limited per
project, and stores only a sample of payloads — so a crash loop costs queue depth
rather than availability.

## 🛠️ Tech Stack

- **Backend**: FastAPI + SQLModel (SQLite)
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS
- **SDK**: vanilla JS, no build step
- **AI** *(optional)*: Google Gemini, for stack-trace explanation only

## 🚀 Quick Start

### Prerequisites

- [Python 3.11+](https://www.python.org/downloads/)
- [Node.js](https://nodejs.org/)
- Optionally a [Gemini API key](https://aistudio.google.com/apikey) for the explain feature

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # optional: set GEMINI_API_KEY
uvicorn backend.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

### Create a project and send your first event

```bash
curl -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"my-app"}'
```

That returns a `public_key` and a DSN. Then either point the SDK at it:

```js
import * as Klaxon from './sdk/klaxon.js'
Klaxon.init({ dsn: 'http://<public_key>@localhost:8000/<project_id>' })
```

or fire a realistic batch of crashes:

```bash
python scripts/generate_crashes.py --count 1000 --concurrency 16
```

which prints throughput and p50/p95/p99 ingest latency, then shows the events
collapsing into a handful of issues.

## 🔌 API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects` | Create a project (returns key + DSN) |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/{project_id}/store` | Ingest one event → `202` |
| `GET` | `/api/issues?project_id=` | List grouped issues |
| `GET` | `/api/issues/{id}` | Issue detail with trace and breadcrumbs |
| `POST` | `/api/issues/{id}/status` | Resolve / ignore / reopen |
| `POST` | `/api/issues/{id}/explain` | Gemini root-cause analysis |
| `GET` | `/api/alerts?project_id=` | Alerts that fired |
| `GET` | `/api/alerts/rules?project_id=` | Alert rules |
| `POST` | `/api/alerts/rules/{id}/toggle` | Enable / disable a rule |

## 🧪 Tests

```bash
pip install pytest
python -m pytest tests/ -q
```

Covers message normalisation, fingerprint stability across line-number and
build-hash changes, cross-browser trace grouping, dedup, payload sampling,
regression detection, and the alert cooldown.

## 🗺️ Roadmap

Implemented: ingest, grouping, dedup, sampling, rate limiting, alerting with
cooldown, regression detection, project management, AI explain.

Not yet: Redis queue and background workers (ingest is currently synchronous),
hourly rollup buckets for sparklines, retention purge, and source-map support for
minified traces.
