# DSA Portal backend (API + worker)

Fastify REST API (`/api/v1`) with Socket.IO, and a separate worker process that judges submissions in a sandbox.
PostgreSQL is the only service it needs: it holds the data **and** the job queue (`submissions` rows) **and**
the real-time events (`LISTEN/NOTIFY`). No Redis is needed for the backend.

```
client ──HTTP/WS──▶ API (server/) ──SQL──▶ PostgreSQL ◀──SQL── worker (workers/) ──spawn──▶ sandbox child
```

## Start it (about 5 minutes)

Needs **Node.js 20** (`node -v`), **npm 10+** and **Docker** (or your own PostgreSQL 14+).

```bash
git clone <repo-url> dsa-portal && cd dsa-portal
npm ci                                   # whole monorepo, ~1–2 min
npm run db:up                            # PostgreSQL 16 on localhost:5432 (postgres/postgres) via infra/docker-compose.yml
npm run build                            # core, server, workers
npm run db:migrate && npm run db:seed    # schema + 40 problems
```

Then, in two terminals:

```bash
npm run start -w server     # API + Socket.IO on http://localhost:3000
npm run start -w workers    # judges submissions; start more of these to scale out
```

Open **http://localhost:3000/docs** for the API reference (rendered from `docs/openapi.yaml`).

### Try it

```bash
API=http://localhost:3000/api/v1
curl -s -XPOST $API/auth/register -H 'content-type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"Str0ng-pass!"}'
TOKEN=$(curl -s -XPOST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"Str0ng-pass!"}' | node -pe 'JSON.parse(fs.readFileSync(0)).accessToken')

curl -s "$API/problems/random?topic=Arrays&difficulty=Easy" -H "authorization: Bearer $TOKEN"
ID=$(curl -s -XPOST $API/submissions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"problemId":"two-sum","code":"function solve({nums,target}){const m=new Map();for(let i=0;i<nums.length;i++){if(m.has(target-nums[i]))return[m.get(target-nums[i]),i];m.set(nums[i],i)}}"}' \
  | node -pe 'JSON.parse(fs.readFileSync(0)).submissionId')
sleep 2; curl -s $API/submissions/$ID -H "authorization: Bearer $TOKEN"     # status: judged, passed 5/5
curl -s $API/stats/me -H "authorization: Bearer $TOKEN"
```

More examples (every endpoint, Socket.IO): [`docs/api-examples.md`](../docs/api-examples.md).

## Configuration

Everything has a development default; production needs at least `JWT_SECRET`, `DATABASE_URL` and `CORS_ORIGINS`.
All variables, with comments: [`.env.example`](../.env.example). There's no dotenv loader, so export them
(`set -a; source .env; set +a`) or set them in your process manager.

| Variable                               | Default                                                    | What                                    |
| -------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`                         | `postgresql://postgres:postgres@localhost:5432/dsa_portal` | API and worker                          |
| `JWT_SECRET`                           | dev secret (**refused when `NODE_ENV=production`**)        | API                                     |
| `PORT`                                 | 3000                                                       | API                                     |
| `CORS_ORIGINS`                         | any origin in dev, none in prod                            | API + Socket.IO allow-list              |
| `WORKER_CONCURRENCY`                   | 2                                                          | judging loops per worker process        |
| `SUBMIT_QUOTA_PER_MINUTE` / `_PER_DAY` | 10 / 500                                                   | per-user quotas                         |
| `WORKER_METRICS_PORT`                  | off                                                        | Prometheus `GET /metrics` on the worker |

## Tests

```bash
npx jest                                       # unit + API tests, no database needed (PostgreSQL suites skip)
createdb -U postgres dsa_portal_test           # once
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest --runInBand   # everything
```

With `TEST_DATABASE_URL` the run includes the **full-flow test** (`workers/__tests__/full-flow.e2e.test.ts`): it builds
and starts the real API and worker, then register → login → random problem → submit → result by polling and by
Socket.IO → stats updated. It also includes the queue/real-time end-to-end tests and the chaos test.

Scripts in `workers/` (need a migrated `DATABASE_URL`, after `npm run build`):

```bash
npm run chaos -w workers    # SIGKILL a worker mid-job; the job is judged exactly once
npm run load  -w workers    # 100 concurrent submissions; p50/p95/p99, throughput, error rate
```

## Layout

| Path                      | What                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `server/src/app.ts`       | `buildApp()`: plugins, error format, limits, security headers, routes, `/docs`    |
| `server/src/index.ts`     | production wiring (PostgreSQL stores)                                             |
| `server/src/modules/*`    | one folder per feature: routes + store (in-memory for tests, PostgreSQL for real) |
| `server/src/db`           | pool, migrations, repositories, seed (Person 2)                                   |
| `workers/src/main.ts`     | worker entry: queue loop, daily challenge, metrics, graceful shutdown             |
| `workers/src/pg-queue.ts` | claim with `FOR UPDATE SKIP LOCKED`, leases, retries, dead-letter                 |
| `core/src/sandbox.ts`     | sandbox: one child process per test, vm context, permission model, limits         |

Design docs: [`architecture.md`](../docs/architecture.md), [`queue-design.md`](../docs/queue-design.md),
[`sandbox-decision.md`](../docs/sandbox-decision.md), [`threat-model.md`](../docs/threat-model.md),
[`websocket-events.md`](../docs/websocket-events.md), [`load-test-report.md`](../docs/load-test-report.md),
[`report/part-1.md`](../docs/report/part-1.md).

## Troubleshooting

- **`ECONNREFUSED 5432`:** PostgreSQL isn't up. Run `npm run db:up` and wait for `docker ps` to show it healthy.
- **Submissions stay `queued`:** the worker isn't running (`npm run start -w workers`).
- **`429 QUOTA_EXCEEDED`:** 10 submissions/minute per user by default. Raise `SUBMIT_QUOTA_PER_MINUTE` for demos.
- **Port 5432 taken by a local PostgreSQL:** use it instead. Set `DATABASE_URL` and skip `db:up`.
