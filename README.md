# DSA Practice Platform

Practise data structures and algorithms anywhere: pick a topic and a difficulty, get a problem, ask for hints, write
JavaScript and have it judged in a sandbox, with live results and progress stats. One engine and one API serve
four front ends: **CLI, Web, Desktop and Mobile**. Offline work syncs back to the server when you reconnect.

[![CI](https://github.com/dipu01-code/DSA_Portal/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
![Node 20](https://img.shields.io/badge/node-20.x-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Running the clients](#running-the-clients)
- [Configuration](#configuration)
- [Testing and quality](#testing-and-quality)
- [Deployment](#deployment) ([Render](#deploy-on-render), [self-hosted](#self-hosted-docker-compose))
- [API](#api)
- [Documentation](#documentation)
- [Team](#team)
- [Known limitations](#known-limitations)

## Features

- **Practice:** 8 topics (Arrays, Strings, LinkedList, Trees, Graphs, Dynamic Programming, Sorting, Searching) at
  three difficulties, random problem selection, progressive hints and reference solutions.
- **Sandboxed judging:** submissions run in an isolated child process with time and memory limits, against
  predefined test cases, on a separate, horizontally scalable worker.
- **Live results:** submission status, leaderboard and daily-challenge updates over Socket.IO.
- **Progress tracking:** attempted/solved counts, per-topic breakdown, streaks, leaderboard and a daily challenge.
- **Accounts and security:** JWT access and refresh tokens (refresh-token rotation with reuse detection), bcrypt,
  per-IP and per-user rate limits, submission quotas, CORS allow-list, security headers and an append-only audit log.
- **Offline-first:** desktop and mobile keep working offline and push the queued work through `/api/v1/sync`
  (idempotent operations with a hybrid logical clock).
- **Operations:** health probes, Prometheus metrics, dead-letter queue with admin requeue, backups with checksum
  verification, and a production Docker stack behind nginx.

## Architecture

```
 CLI ─┐
 Web ─┤                ┌──────────────── API (server/) ───────────────┐
Desk ─┼── HTTPS / WS ─▶│ Fastify REST /api/v1 · Socket.IO · JWT auth   │
 Mob ─┘                │ rate limits · quotas · /health · /metrics     │
                       └───────────────┬───────────────────────────────┘
                                       │ SQL
                       ┌───────────────▼───────────────┐   LISTEN/NOTIFY   ┌──────────── worker (workers/) ───────────┐
                       │ PostgreSQL                     │◀────────────────▶│ claims queued submissions (SKIP LOCKED),   │
                       │ data · job queue · events      │                   │ judges in a sandboxed child process        │
                       └────────────────────────────────┘                   └────────────────────────────────────────────┘
                       Redis (optional): read cache for problems, leaderboard and stats
```

- **`core/`** is the shared engine: problem schema and loader, random selector, hint and solution services, the
  sandbox executor, sync protocol types and the local SQLite storage.
- **PostgreSQL is the only required service.** It stores the data, acts as the job queue (`submissions` rows
  claimed with `FOR UPDATE SKIP LOCKED`, retries with backoff, dead-letter) and carries real-time events via
  `LISTEN/NOTIFY`. Redis only adds caching.
- **API and worker are separate processes**, so judging load never blocks the API and workers scale out by simply
  starting more of them.

More detail: [docs/architecture.md](docs/architecture.md) · [queue design](docs/queue-design.md) ·
[sandbox decision](docs/sandbox-decision.md) · [threat model](docs/threat-model.md).

## Tech stack

| Area      | Technology                                                                   |
| --------- | ---------------------------------------------------------------------------- |
| Language  | TypeScript, Node.js 20, npm workspaces (monorepo)                            |
| API       | Fastify 5, zod, pino, Socket.IO, `@fastify/jwt`, bcrypt                      |
| Data      | PostgreSQL 16 (server), SQLite (local/offline), Redis (cache)                |
| Web       | React, Vite, Monaco editor, Zustand, Recharts                                |
| Desktop   | Electron (reuses the web app, judges offline with Electron as Node)          |
| Mobile    | React Native with Expo                                                       |
| Shared UI | `ui-core`: typed API client generated from OpenAPI, stores, hooks, sync      |
| Testing   | Jest, Vitest, Playwright, OpenAPI contract tests                             |
| Delivery  | Docker multi-stage images, docker compose, nginx, GitHub Actions, Prometheus |

## Repository layout

| Folder     | What it is                                                                            |
| ---------- | ------------------------------------------------------------------------------------- |
| `core/`    | Shared engine: problems, hints, solutions, sandbox, sync protocol, SQLite storage     |
| `server/`  | REST API + Socket.IO, PostgreSQL repositories, migrations, auth, cache, sync, health  |
| `workers/` | Judging worker (PostgreSQL queue), metrics endpoint, load-test scripts                |
| `cli/`     | The original terminal app                                                             |
| `web/`     | React web app                                                                         |
| `desktop/` | Electron desktop app                                                                  |
| `mobile/`  | Expo (React Native) app                                                               |
| `ui-core/` | Code shared by web, desktop and mobile: API client, auth, stores, offline cache, sync |
| `infra/`   | docker compose (dev and prod), Dockerfiles, nginx, Prometheus config and alerts       |
| `scripts/` | Database backup/restore, load seeding, query benchmarks                               |
| `docs/`    | Architecture, OpenAPI spec, design notes, runbooks, reports, daily handovers          |

## Getting started

**Prerequisites:** Node.js 20, npm 10+, and Docker (or your own PostgreSQL 14+).

```bash
git clone https://github.com/dipu01-code/DSA_Portal.git dsa-portal && cd dsa-portal
npm ci                                  # installs every workspace
npm run db:up                           # PostgreSQL (and Redis) on localhost via infra/docker-compose.yml
npm run build                           # core, server, workers
npm run db:migrate && npm run db:seed   # schema + seed problems
```

Start the backend in two terminals:

```bash
npm run start -w server     # API + Socket.IO on http://localhost:3000
npm run start -w workers    # judges submissions; run more to scale out
```

Open **http://localhost:3000/docs** for the interactive API reference. A step-by-step `curl` walkthrough (register,
log in, get a problem, submit, read the result) is in [server/README.md](server/README.md) and
[docs/api-examples.md](docs/api-examples.md).

## Running the clients

| Client  | Command                                        | Notes                                                                |
| ------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Web     | `npm run dev -w web`                           | Vite dev server; `npm run dev:mock -w web` runs it without a backend |
| Desktop | `npm run dev -w desktop`                       | Installers: `npm run dist -w desktop`                                |
| Mobile  | `npm run start -w mobile`                      | Expo; `npm run android -w mobile` for a device                       |
| CLI     | `npm run build -w cli && npm run start -w cli` | Terminal practice mode                                               |

End-user guide: [docs/user-manual.md](docs/user-manual.md). Release builds: [docs/design/release.md](docs/design/release.md).

## Configuration

Every variable has a development default. Production needs at least `JWT_SECRET`, `DATABASE_URL` and
`CORS_ORIGINS` (with `NODE_ENV=production` the API refuses to start without `JWT_SECRET`). The full, commented list
is in [`.env.example`](.env.example). There is no dotenv loader, so export them (`set -a; source .env; set +a`) or
set them in your process manager.

| Variable                                  | Used by     | Purpose                                            |
| ----------------------------------------- | ----------- | -------------------------------------------------- |
| `DATABASE_URL`                            | API, worker | PostgreSQL connection                              |
| `JWT_SECRET`                              | API         | Signs access tokens                                |
| `CORS_ORIGINS`                            | API         | Comma-separated browser origins (CORS + Socket.IO) |
| `REDIS_URL`                               | API         | Optional read cache                                |
| `WORKER_CONCURRENCY`                      | worker      | Judging loops per process (default: one per CPU)   |
| `SUBMIT_QUOTA_PER_MINUTE` / `_PER_DAY`    | API         | Per-user submission quotas                         |
| `RATE_LIMIT_IP_PER_MIN` / `_USER_PER_MIN` | API         | Request rate limits                                |
| `TEST_DATABASE_URL`                       | tests       | Separate database for the PostgreSQL test suites   |

## Testing and quality

```bash
npx jest                                                    # unit + API tests (PostgreSQL suites skip without a DB)
createdb -U postgres dsa_portal_test                        # once
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest --runInBand   # everything
npm test -w ui-core && npm test -w web && npm test -w mobile # client suites
npm run test:e2e -w web                                     # Playwright, against the real server
npm run lint && npm run format                              # ESLint + Prettier (same checks as CI)
```

The PostgreSQL run includes the **full-flow test**, which builds and starts the real API and worker, then goes
register → login → random problem → submit → result by polling and by Socket.IO → stats updated. It also runs the
queue and real-time end-to-end tests, a chaos test (a worker killed mid-job), the OpenAPI contract test (every route
is checked against `docs/openapi.yaml`), the sync tests and the database security tests.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, format and type checks, all test suites against
a PostgreSQL service, and builds both Docker images on every push to `main` and on pull requests.

## Deployment

### Deploy on Render

[`render.yaml`](render.yaml) is a Render Blueprint that creates everything from this repo: the API (Docker, runs
migrations on start), the judging worker (Docker), PostgreSQL and the web app (static site on Render's CDN).
Region: Singapore.

1. Sign in at [render.com](https://render.com) with GitHub and allow access to this repository.
2. **New → Blueprint**, pick the repo; Render reads `render.yaml` and lists the four resources.
3. Fill in the two prompted values (service URLs are `https://<service-name>.onrender.com`):
   - `CORS_ORIGINS` (API): `https://dsa-portal-web.onrender.com`
   - `VITE_API_URL` (web): `https://dsa-portal-api.onrender.com`
4. **Apply**. The first build takes several minutes. If Render gives a service a different URL (name taken), update
   both values under the service's **Environment** tab, then redeploy the web app.
5. Load the problem bank once: open **dsa-portal-worker → Shell** and run `node server/dist/db/seed.js`.
   It also creates two demo accounts (`admin@dsa.portal`, `student@dsa.portal`, password `password123`);
   change or delete them before sharing the site.
6. Open `https://dsa-portal-web.onrender.com`. API docs: `https://dsa-portal-api.onrender.com/docs`.

Costs (check Render's current pricing): the API and web app use free plans. The free API sleeps after about 15
minutes idle, so the first request then takes about a minute. The worker needs a paid instance (Render has no free
background workers). The free PostgreSQL is time-limited, so switch `plan` in `render.yaml` to a paid one to keep
data. Every push to `main` redeploys automatically. Point desktop and mobile builds at the API URL to use the
same backend.

### Self-hosted (Docker Compose)

The production stack (PostgreSQL, Redis, API, worker and an nginx reverse proxy, on separated
networks with resource limits and health checks) is defined in `infra/docker-compose.prod.yml`:

```bash
export JWT_SECRET=<long-random-secret> CORS_ORIGINS=https://your.domain POSTGRES_PASSWORD=<pw> REDIS_PASSWORD=<pw>
docker compose -f infra/docker-compose.prod.yml up -d --build    # migrate runs first, then API, worker, nginx
docker compose -f infra/docker-compose.prod.yml run --rm --no-deps migrate node server/dist/db/seed.js   # first deploy: problem bank
docker compose -f infra/docker-compose.prod.yml ps
```

The one-shot `migrate` service applies every pending migration before the API and worker start. The seed also
creates two demo accounts (`admin@dsa.portal`, `student@dsa.portal`, password `password123`): change or delete
them on a real deployment.

- Liveness and readiness probes: `GET /health/live`, `GET /health/ready` (`GET /health` is an alias of ready).
- Metrics: `GET /metrics` on the API (internal network only; nginx returns 404 for it), `WORKER_METRICS_PORT` on each worker; alert rules in `infra/monitoring/`.
- Backups: `npm run db:backup` / `npm run db:restore` (gzip dump plus SHA-256 manifest; restore runs in a single
  transaction).

Guides: [docker-production](docs/infra/docker-production.md) · [CI/CD](docs/infra/ci-cd.md) ·
[monitoring](docs/infra/monitoring.md) · [runbook](docs/infra/runbook.md) · [backup and DR](docs/db/backup-and-dr.md).

## API

REST under `/api/v1`, JSON, JWT bearer auth. **[docs/openapi.yaml](docs/openapi.yaml) is the source of truth.**
It is served at `/docs` and drives both the contract tests and the generated TypeScript client in `ui-core`.

| Area        | Endpoints                                                                               |
| ----------- | --------------------------------------------------------------------------------------- |
| Auth        | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`   |
| Problems    | `GET /topics`, `/problems`, `/problems/random`, `/problems/{id}`, `/hints`, `/solution` |
| Submissions | `POST /submissions` (supports `Idempotency-Key`), `GET /submissions/{id}`               |
| Stats       | `GET /stats/me`, `/stats/me/topics`, `/stats/me/streak`                                 |
| Social      | `GET /leaderboard`, `/daily-challenge`                                                  |
| Sync        | `POST /sync/push`, `GET /sync/pull`, `GET /sync/bootstrap`                              |
| Admin       | problem and test-case management, dead-letter queue (`/admin/queue/failed`)             |

Real-time events are documented in [docs/websocket-events.md](docs/websocket-events.md).

## Documentation

| Topic           | Where                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| System design   | [architecture](docs/architecture.md), [queue](docs/queue-design.md), [sandbox](docs/sandbox-decision.md), [sync](docs/db/sync-design.md) |
| Database        | [ER diagram](docs/db/er-diagram.md), [indexes](docs/db/indexes.md), [optimisation report](docs/db/optimization-report.md)                |
| Security        | [threat model](docs/threat-model.md), [DB hardening](docs/db/security-hardening.md), [auth design](docs/design/auth-design.md)           |
| Performance     | [load-test report](docs/load-test-report.md)                                                                                             |
| Clients         | [components](docs/design/components.md), [cache design](docs/design/cache-design.md), [user manual](docs/user-manual.md)                 |
| Project reports | [report part 1](docs/report/part-1.md), [part 3](docs/report/part-3.md), [demo script](docs/report/demo-script.md)                       |
| Process         | [daily handovers](docs/handover/), [change requests](docs/CHANGE_REQUESTS.md), [manual test checklist](docs/test/manual-checklist.md)    |

## Team

Built in 10 days by a team of three, each owning a slice of the monorepo:

| Role                                   | Owns                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Backend, core engine and system design | `core/`, `workers/`, API modules (problems, submissions, real-time, leaderboard, daily), OpenAPI |
| Database, sync and DevOps              | `server/src/db`, `server/src/sync`, core storage/sync, `infra/`, `scripts/`, CI                  |
| Clients, auth and stats                | `web/`, `desktop/`, `mobile/`, `ui-core/`, auth, admin, stats, Redis cache                       |

Changes to an agreed endpoint, table column or WebSocket event go through
[docs/CHANGE_REQUESTS.md](docs/CHANGE_REQUESTS.md) first.

## Known limitations

- **Offline submissions are trusted.** `/sync/push` stores the verdict the client judged locally, so a modified
  client could report a false "solved". Server-side re-judging of synced submissions is the planned fix.
- The core **SQLite storage** (`core/src/storage`, better-sqlite3) is tested but not yet wired into a client;
  desktop and mobile currently use their own local stores. It is an optional dependency, so server images skip it.
- The production stack is smoke-tested end to end (20 checks through nginx), but not load-tested in containers.
- Per-test results in the API carry `passed`/`actual`/`expected` only, so clients cannot tell a timeout from a
  wrong answer.
