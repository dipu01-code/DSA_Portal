# Database Design Decisions

## Decision 1: Migration Tool — node-pg-migrate

**Date:** 2026-11-09  
**Status:** Accepted  
**Author:** Person 2

### Context

The project needs a migration tool to manage PostgreSQL schema changes. The two main candidates
in the Node.js ecosystem are **node-pg-migrate** (raw SQL migrations) and **Prisma** (schema DSL
with generated client).

### Comparison

| Criterion                 | node-pg-migrate                                               | Prisma                                                |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| SQL control               | Full — write raw DDL                                          | Prisma schema DSL → generated SQL                     |
| Lock safety               | Manual `CREATE INDEX CONCURRENTLY`                            | No concurrent index support                           |
| Enum handling             | Native `CREATE TYPE ... AS ENUM`                              | Limited `ALTER TYPE ... ADD VALUE` support            |
| Runtime dependency        | Tiny (~pg driver only)                                        | Heavy (@prisma/client + query engine binary ~15 MB)   |
| Learning curve            | Low (just SQL)                                                | Medium (schema DSL + client API + introspection flow) |
| Type safety at query time | Manual or via code-gen (e.g. pgtyped)                         | Excellent auto-generated TypeScript types             |
| Team fit                  | Person 2 writes SQL; Person 1/3 consume repository interfaces | All 3 persons would need to learn Prisma DSL          |
| Viva readiness            | "We wrote the SQL ourselves"                                  | "Prisma generated it for us"                          |

### Decision

**node-pg-migrate**, because:

1. **Repository interface pattern already chosen.** `@dsa-portal/core/types.ts` defines
   `ProblemRepository`, `SubmissionRepository`, `UserRepository`, and `StatsRepository` as pure
   TypeScript interfaces. The DB layer (`/server/src/db`) will implement these interfaces using
   the `pg` (node-postgres) client with parameterized SQL queries. Prisma's generated client
   would be a redundant abstraction layer.

2. **Full DDL control is essential.** The schema uses partial indexes
   (`WHERE is_published = true`), JSONB columns with CHECK constraints, composite UNIQUE
   constraints, and PostgreSQL-specific features (`gen_random_uuid()`, `TIMESTAMPTZ`, `INET`).
   Writing raw SQL ensures we get exactly the schema we designed.

3. **Smaller dependency footprint.** In a 10-day project, minimizing dependencies reduces
   build times, CI complexity, and attack surface.

4. **Better for viva.** Demonstrating raw SQL knowledge is more impressive and defensible than
   "Prisma generated the migration for us."

### Consequences

- Person 2 maintains migration files in `/server/src/db/migrations/`.
- Person 1 and Person 3 consume the DB through repository implementations, not through a
  Prisma client.
- Type safety at the query layer is the responsibility of the repository implementations
  (TypeScript interfaces enforce the contract at compile time).

---

## Decision 2: ID Strategy — UUID + Slug

**Date:** 2026-11-09  
**Status:** Accepted  
**Author:** Person 2

### Context

The existing `@dsa-portal/core` engine uses slug-based string IDs for problems (e.g.,
`"two-sum"`, `"palindrome-number"`). The OpenAPI spec uses `format: uuid` for users and
submissions. We need a consistent ID strategy that works across the DB, API, and core engine.

### Decision

| Entity           | PK type                        | Additional                                                            |
| ---------------- | ------------------------------ | --------------------------------------------------------------------- |
| `users`          | `UUID` (`gen_random_uuid()`)   | —                                                                     |
| `problems`       | `UUID` PK + `slug TEXT UNIQUE` | API routes accept slug in URL paths; all FK references use UUID       |
| `submissions`    | `UUID` (`gen_random_uuid()`)   | —                                                                     |
| All other tables | `UUID` (`gen_random_uuid()`)   | Except `daily_challenges` (DATE PK) and `audit_log` (BIGINT IDENTITY) |

### Rationale

- **UUID PKs** are globally unique, safe for distributed systems, and don't leak information
  about record count or creation order.
- **Problem slugs** preserve compatibility with the existing core engine (`getProblem("two-sum")`)
  and provide human-readable URL paths (`/api/v1/problems/two-sum`).
- **`daily_challenges` uses DATE PK** because there's exactly one challenge per date — the date
  itself is the natural key.
- **`audit_log` uses BIGINT IDENTITY** because audit records are append-only and high-volume.
  Sequential IDs are smaller, faster to index, and naturally ordered. UUID overhead is
  unnecessary for a table never referenced by FK.

### Consequences

- The API layer must resolve `slug → UUID` when accepting problem IDs in URL paths.
- Core engine's `getProblem(id)` works with slugs; the DB repository's `findById` accepts
  either UUID or slug.

---

## Decision 3: Topic Storage — TEXT with CHECK Constraint (not ENUM type)

**Date:** 2026-11-09  
**Status:** Accepted  
**Author:** Person 2

### Context

Topics in the system (`Arrays`, `Strings`, `LinkedList`, etc.) are a fixed set but may grow
over the project lifetime (e.g., adding `Heaps`, `Greedy`, `Backtracking`).

### Decision

Store `topic` as `TEXT` with a `CHECK` constraint, not as a PostgreSQL `ENUM` type.

### Rationale

- PostgreSQL `ENUM` types cannot have values removed, and adding values requires
  `ALTER TYPE ... ADD VALUE` which cannot run inside a transaction.
- A `CHECK` constraint can be dropped and recreated in a single migration transaction.
- `difficulty` (`Easy`, `Medium`, `Hard`) uses an `ENUM` type because it is truly fixed —
  difficulty levels won't change.

### Consequences

- Adding a new topic requires a migration that drops and recreates the CHECK constraint.
- The application layer validates topics against the `Topic` type from `@dsa-portal/core`.
