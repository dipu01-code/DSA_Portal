# API examples (Days 4–10)

curl examples for the backend's endpoints. Contract: `/docs/openapi.yaml`, rendered at **http://localhost:3000/docs** (Day 10).
Register/login examples: [`server/README.md`](../server/README.md). Sync endpoints are Person 2's.

## Setup

```bash
npm install
createdb dsa_portal                                   # once, on your local PostgreSQL
export DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal
npm run db:migrate && npm run db:seed                 # 40 problems + users admin/student
npm run build
npm run start -w server                               # terminal 1 (PORT, default 3000)
npm run start -w workers                              # terminal 2: judges queued submissions
```

```bash
B=http://localhost:3000/api/v1
# TEMP until Person 3's /auth/login is merged: sign a dev token with the same JWT_SECRET as the server.
# Defaults to the seeded `student` user; submissions must belong to a real row in `users`.
TOKEN=$(npm run -s dev:token -w server)
H="Authorization: Bearer $TOKEN"
```

Every response carries an `x-request-id` header (send your own to correlate logs).
Errors always look like:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "difficulty: Invalid enum value ...",
  "statusCode": 400,
  "timestamp": "2026-11-11T16:35:52.464Z",
  "path": "/api/v1/problems"
}
```

## Health (not in spec yet, see CR-002)

```bash
curl -s $B/health
# {"status":"ok","service":"dsa-portal-server"}
```

## Topics (no auth)

```bash
curl -s $B/topics
# {"topics":["Arrays","Dynamic Programming","Graphs","LinkedList","Searching","Sorting","Strings","Trees"]}
```

## Problems

```bash
# List with filters + keyset pagination (limit 1..100, default 20)
curl -s "$B/problems?limit=2&difficulty=Easy" -H "$H"
# {"data":[{"id":"merge-two-sorted-lists",...},{"id":"palindrome-number",...}],"nextCursor":"cGFsaW5kcm9tZS1udW1iZXI"}

# Next page: pass nextCursor back
curl -s "$B/problems?limit=2&cursor=cGFsaW5kcm9tZS1udW1iZXI" -H "$H"

# Random problem by topic and/or difficulty (404 if nothing matches)
curl -s "$B/problems/random?topic=Arrays&difficulty=Easy" -H "$H"

# One problem by id (testCases input/expected are JSON strings)
curl -s $B/problems/two-sum -H "$H"
```

## Hints and solution

```bash
# First N hints (omit upto for all)
curl -s "$B/problems/two-sum/hints?upto=1" -H "$H"
# {"hints":["Use a hash map to store value -> index as you iterate."]}

# Reference solution: 403 SOLUTION_LOCKED until this user has a submission that passed every test
curl -s $B/problems/two-sum/solution -H "$H"
```

## Submissions

```bash
# Submit: saved as `queued` and returned at once; a worker process judges it in the background
curl -s -X POST $B/submissions -H "$H" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-retry-key-1' \
  -d '{"problemId":"two-sum","code":"function solve({ nums, target }) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }"}'
# {"submissionId":"93b43641-...","status":"queued"}

# Same request + same Idempotency-Key again (e.g. after a network timeout): same submission, no second job
# {"submissionId":"93b43641-...","status":"running"}
# Same key with a different body → 409 IDEMPOTENCY_KEY_REUSED

# Poll until status is judged (or failed); 404 for other users' submissions
curl -s $B/submissions/93b43641-... -H "$H"
# {"id":"93b43641-...","status":"judged","passed":5,"total":5,"results":[{"testCaseIndex":0,"passed":true,"actual":"[0,1]","expected":"[0,1]"},...],"judgedAt":"..."}

# My submissions, newest first, optional problemId filter, keyset pagination
curl -s "$B/submissions?limit=5&problemId=two-sum" -H "$H"
```

## Queue: backpressure and dead-letter list (Day 6)

```bash
# When QUEUE_MAX_WAITING submissions are already waiting, new submissions are refused for a while
curl -si -X POST $B/submissions -H "$H" -H 'Content-Type: application/json' -d '{"problemId":"two-sum","code":"..."}'
# HTTP/1.1 429 Too Many Requests
# retry-after: 10
# {"error":"QUEUE_FULL","message":"Too many submissions waiting; retry in 10s","statusCode":429,...}

# Admin only (403 FORBIDDEN otherwise): submissions that failed every retry, newest first, keyset pagination
# Token for the seeded admin user (role is read from the users table on every request)
AH="Authorization: Bearer $(npm run -s dev:token -w server -- 00000000-0000-0000-0000-000000000001)"
curl -s "$B/admin/queue/failed?limit=20" -H "$AH"
# {"data":[{"id":"5b1c...","problemId":"two-sum","userId":"...","attempts":3,"lastError":"connect ECONNREFUSED ...","createdAt":"...","failedAt":"..."}],"nextCursor":null}

# Put one back on the queue with a fresh retry budget (404 if it is not in the dead-letter list)
curl -s -X POST $B/admin/queue/failed/5b1c.../requeue -H "$AH"
# {"submissionId":"5b1c...","status":"queued"}

# Worker metrics (Prometheus text format; set WORKER_METRICS_PORT on the worker)
curl -s localhost:9464/metrics
# dsa_queue_waiting 0
# dsa_queue_active 1
# dsa_queue_failed 2
# dsa_queue_jobs_total{outcome="judged"} 41
# dsa_queue_job_duration_seconds_bucket{le="1"} 38 ...
```

## Leaderboard and daily challenge (Day 7)

```bash
# Public. Ranked by problems solved, then who got there first. period=week|all (default all), keyset pagination
curl -s "$B/leaderboard?period=week&limit=10"
# {"data":[{"userId":"...","username":"student","solved":3,"totalScore":5,"rank":1},...],"nextCursor":null}

# Today's (UTC) challenge, the same problem for everyone
curl -s $B/daily-challenge -H "$H"
# {"date":"2026-11-13","problemId":"valid-parentheses","problem":{"id":"valid-parentheses","title":"Valid Parentheses",...}}
```

Real-time events (Socket.IO, same port): see [`websocket-events.md`](./websocket-events.md). Quick check from a terminal:

```bash
node -e "require('socket.io-client').io('http://localhost:3000',{auth:{token:process.argv[1]}}).onAny((e,d)=>console.log(e,d))" "$TOKEN"
# then submit in another terminal → submission:queued, submission:running, submission:finished
```

## Common errors

```bash
curl -s $B/problems                                   # 401 UNAUTHORIZED
curl -s "$B/problems?difficulty=Insane" -H "$H"       # 400 VALIDATION_ERROR
curl -s $B/problems/nope -H "$H"                      # 404 NOT_FOUND
```

## Limits (Day 8)

Every `429` carries `Retry-After` (seconds) and says why in `error`:

```bash
# 11th submission within a minute by the same user (SUBMIT_QUOTA_PER_MINUTE, default 10; 500 per day)
# HTTP/1.1 429 Too Many Requests
# retry-after: 42
# {"error":"QUOTA_EXCEEDED","message":"Submission quota of 10 per minute reached; retry in 42s","statusCode":429,...}

# Any route: more than RATE_LIMIT_IP_PER_MIN (300) per IP or RATE_LIMIT_USER_PER_MIN (120) per user
# {"error":"RATE_LIMITED","message":"Too many requests from this IP; retry in 17s","statusCode":429,...}

# Bodies over 512 KiB → 413 PAYLOAD_TOO_LARGE; code containing a NUL character → 400 VALIDATION_ERROR
curl -sI $B/health | grep -iE 'x-content-type|x-frame|content-security'   # security headers on every response
```

## API reference (Day 10)

```bash
open http://localhost:3000/docs                       # Redoc, rendered from the spec below
curl -s http://localhost:3000/docs/openapi.yaml | head # the same openapi.yaml the contract test checks
```
