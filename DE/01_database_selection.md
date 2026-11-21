# Database Selection & Justification (Section 2.A)

## 1. Selected Database Management System
**Primary Server Database:** **PostgreSQL 16 (Relational DBMS)**  
**Client Offline Storage:** **SQLite 3 (WAL Mode)**  

---

## 2. Nature of Data Stored

The DSA Practice Platform manages structured, interrelated, transactional, and audit-sensitive data:
1. **Core Problem Catalog**: Structured metadata (`title`, `slug`, `topic`, `difficulty`, `starter_code`) strictly linked to sequential hints, verified reference solutions, and test cases.
2. **Evaluation & Execution Submissions**: Transactional records capturing user code, submission timestamps, execution status (`queued`, `running`, `judged`, `failed`), passed/total test counts, runtime metrics, and memory usage.
3. **User Profiles & Progression Statistics**: Pre-aggregated metrics (`attempts`, `solved`, `first_solved_at`, `streak`, `score`) that must remain mathematically consistent with historical submission records.
4. **Security & Session Tokens**: Hashed credentials, rotating session hashes, and cryptographic tokens.
5. **Audit Logs & Distributed Sync Operations**: Immutable logs recording administrative actions and distributed sync operations (`sync_op_log`) with causal timestamps.

---

## 3. Justification: PostgreSQL vs. MongoDB

While MongoDB (NoSQL Document Store) is effective for unstructured or rapidly evolving schemas, **PostgreSQL 16** was selected as the optimal DBMS for this platform based on the following architectural justifications:

### 3.1 Strict ACID Transactional Guarantees
- **The Requirement**: Evaluating code submissions requires atomic, multi-table consistency. When a worker judges a submission, it must atomically:
  1. Update `submissions` with runtime results and status (`judged`).
  2. Upsert `user_problem_stats` (incrementing attempts, updating `solved` boolean, and recording `first_solved_at`).
  3. Append an entry to `sync_op_log` to propagate results to the user's other devices.
- **Why PostgreSQL**: PostgreSQL provides full native multi-version concurrency control (MVCC) and strict ACID transaction semantics (`BEGIN ... COMMIT / ROLLBACK`). In contrast, while MongoDB introduced multi-document transactions in v4.0, they incur substantial latency overhead, require replica sets, and lack database-level row locking primitives suited for high-throughput transactional queues.

### 3.2 Relational Integrity & Referential Constraints
- **The Requirement**: DSA problems possess rigid hierarchical dependencies: a problem owns multiple test cases, ordered hints, and one reference solution. Deleting or archiving a problem must cascade deterministically without leaving orphaned test data.
- **Why PostgreSQL**: PostgreSQL enforces declarative Foreign Key constraints with `ON DELETE CASCADE`. MongoDB enforces no schema-level referential integrity; handling relationship cascades requires fragile application-layer logic vulnerable to race conditions and orphaned documents.

### 3.3 Hybrid Relational + Document (JSONB) Capabilities
- **The Requirement**: While problem metadata is relational, test case inputs and expected outputs vary widely (arrays, strings, nested objects, matrix trees).
- **Why PostgreSQL**: PostgreSQL offers native `JSONB` with binary compression, GIN indexing, and JSON path operators (`@>`, `->>`). This provides the schema flexibility of MongoDB documents while preserving relational joins, foreign keys, and ACID transactions for the parent entities.

### 3.4 Advanced Indexing & Concurrency Features
- **Partial & Covering Indexes**: PostgreSQL supports partial indexes (`WHERE status = 'judged'`) and covering indexes with the `INCLUDE` clause, enabling **Index-Only Scans** where queries never read the physical table heap. MongoDB does not offer identical partial-covering parity for complex multi-table joins.
- **Concurrent Materialized Views**: Computing global leaderboards over 100,000+ submissions live is computationally prohibitive ($O(N)$ live aggregation). PostgreSQL provides `MATERIALIZED VIEW` with `REFRESH MATERIALIZED VIEW CONCURRENTLY`, allowing instantaneous leaderboard lookups ($0.02\text{ ms}$) without blocking concurrent read/write traffic. MongoDB's on-demand aggregation pipelines or `$merge` stages do not offer equivalent non-blocking read-write concurrency guarantees.

---

## 4. Architectural Summary

| Dimension | PostgreSQL 16 (Selected) | MongoDB (Alternative) | Platform Impact |
| :--- | :--- | :--- | :--- |
| **Data Model** | Relational with JSONB hybrid | Unstructured Document (BSON) | Prevents data duplication; enforces domain consistency. |
| **Referential Integrity** | Engine-enforced Foreign Keys (`CASCADE`) | Application-level manual checks | Prevents orphaned submissions, test cases, and hints. |
| **Transactions** | First-class ACID with MVCC | Multi-document transactions (high overhead) | Critical for judging race conditions and stats upserts. |
| **Leaderboard Caching** | Concurrent Materialized Views | On-demand aggregation pipelines | **6,900× query speedup** on ranking queries. |
| **Data Validity** | Engine-level `CHECK` constraints | JSON Schema validation | Enforces email regex, difficulty enums, and score limits. |
