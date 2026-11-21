-- ============================================================================
-- Data Engineering (DE) Integrated Project — Final Database Schema DDL
-- Database: PostgreSQL 16
-- Features: ACID Relational Core, JSONB Hybrid Types, Indexes, Constraints,
--           Materialized Views, Pl/pgSQL Triggers, and Least-Privilege RBAC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS & CUSTOM ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE submission_status AS ENUM ('queued', 'running', 'judged', 'failed');

-- ----------------------------------------------------------------------------
-- 2. CORE RELATIONAL TABLES
-- ----------------------------------------------------------------------------

-- Table 1: users
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          user_role    NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT chk_username_len CHECK (length(username) >= 3),
    CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Table 2: sessions
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64)  NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Table 3: problems
CREATE TABLE problems (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         VARCHAR(100) NOT NULL UNIQUE,
    title        VARCHAR(255) NOT NULL,
    topic        VARCHAR(50)  NOT NULL,
    difficulty   VARCHAR(20)  NOT NULL,
    description  TEXT         NOT NULL,
    starter_code TEXT         NOT NULL,
    is_published BOOLEAN      NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT chk_difficulty CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    CONSTRAINT chk_topic CHECK (topic IN (
        'Arrays', 'Strings', 'LinkedList', 'Trees',
        'Graphs', 'Dynamic Programming', 'Sorting', 'Searching'
    ))
);

-- Table 4: test_cases
CREATE TABLE test_cases (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    sort_order INT         NOT NULL,
    input      JSONB       NOT NULL,
    expected   JSONB       NOT NULL,
    is_sample  BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_problem_sort_order UNIQUE (problem_id, sort_order)
);

-- Table 5: hints
CREATE TABLE hints (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    level      INT         NOT NULL,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_problem_hint_level UNIQUE (problem_id, level),
    CONSTRAINT chk_hint_level CHECK (level >= 1)
);

-- Table 6: solutions
CREATE TABLE solutions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id  UUID        NOT NULL UNIQUE REFERENCES problems(id) ON DELETE CASCADE,
    code        TEXT        NOT NULL,
    explanation TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 7: daily_challenges
CREATE TABLE daily_challenges (
    challenge_date DATE PRIMARY KEY,
    problem_id     UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 8: submissions
CREATE TABLE submissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_id UUID              NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    code       TEXT              NOT NULL,
    status     submission_status NOT NULL DEFAULT 'queued',
    passed     INT               NOT NULL DEFAULT 0,
    total      INT               NOT NULL DEFAULT 0,
    results    JSONB,
    created_at TIMESTAMPTZ       NOT NULL DEFAULT now(),
    judged_at  TIMESTAMPTZ
);

-- Table 9: user_problem_stats
CREATE TABLE user_problem_stats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_id         UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    attempts           INT         NOT NULL DEFAULT 1,
    solved             BOOLEAN     NOT NULL DEFAULT false,
    first_solved_at    TIMESTAMPTZ,
    last_attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_problem UNIQUE (user_id, problem_id),
    CONSTRAINT chk_attempts CHECK (attempts >= 1)
);

-- Table 10: audit_log (Append-Only)
CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   UUID         NOT NULL,
    old_value   JSONB,
    new_value   JSONB,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Table 11: sync_op_log (Distributed OpLog for Offline Sync)
CREATE TABLE sync_op_log (
    device_id     VARCHAR(64)  NOT NULL,
    op_id         UUID         NOT NULL,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity        VARCHAR(50)  NOT NULL,
    op_type       VARCHAR(20)  NOT NULL,
    payload       JSONB        NOT NULL,
    client_time   TIMESTAMPTZ  NOT NULL,
    hlc_timestamp VARCHAR(64)  NOT NULL,
    server_seq    BIGINT GENERATED ALWAYS AS IDENTITY,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (device_id, op_id),
    CONSTRAINT uq_sync_server_seq UNIQUE (server_seq)
);

-- ----------------------------------------------------------------------------
-- 3. HIGH-PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------

-- Covering Index for User Submission History (Enables 100% Index-Only Scans)
CREATE INDEX idx_submissions_user_history_covering
    ON submissions (user_id, created_at DESC)
    INCLUDE (problem_id, status, passed, total);

-- Partial Index for Judged Submissions Feed
CREATE INDEX idx_submissions_judged_recent
    ON submissions (judged_at DESC, id DESC)
    WHERE status = 'judged';

-- Partial Index for Verified Solved Submissions
CREATE INDEX idx_submissions_user_problem_solved_partial
    ON submissions (user_id, problem_id)
    WHERE status = 'judged' AND passed = total AND total > 0;

-- Keyset (Cursor-Based) Pagination Index
CREATE INDEX idx_submissions_keyset_pagination
    ON submissions (created_at DESC, id DESC, user_id, status);

-- Covering Index for Problems Catalog Filtering
CREATE INDEX idx_problems_catalog_covering
    ON problems (topic, difficulty, is_published)
    INCLUDE (id, slug, title);

-- Index for User Stats Breakdown
CREATE INDEX idx_user_problem_stats_covering
    ON user_problem_stats (user_id, problem_id)
    INCLUDE (solved, attempts, first_solved_at);

-- ----------------------------------------------------------------------------
-- 4. CONCURRENT MATERIALIZED VIEW FOR LEADERBOARD
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_leaderboard AS
SELECT
    u.id AS user_id,
    u.username,
    COUNT(ups.problem_id) FILTER (WHERE ups.solved) AS solved_count,
    COALESCE(SUM(
        CASE p.difficulty
            WHEN 'Easy' THEN 1
            WHEN 'Medium' THEN 2
            WHEN 'Hard' THEN 3
            ELSE 0
        END
    ) FILTER (WHERE ups.solved), 0)::BIGINT AS total_score,
    COUNT(s.id)::BIGINT AS total_submissions,
    RANK() OVER (
        ORDER BY
            COUNT(ups.problem_id) FILTER (WHERE ups.solved) DESC,
            COALESCE(SUM(
                CASE p.difficulty
                    WHEN 'Easy' THEN 1
                    WHEN 'Medium' THEN 2
                    WHEN 'Hard' THEN 3
                    ELSE 0
                END
            ) FILTER (WHERE ups.solved), 0) DESC,
            u.id ASC
    ) AS rank,
    now() AS refreshed_at
FROM users u
LEFT JOIN user_problem_stats ups ON ups.user_id = u.id
LEFT JOIN problems p ON p.id = ups.problem_id AND p.is_published = true
LEFT JOIN submissions s ON s.user_id = u.id
WHERE u.role = 'user'
GROUP BY u.id, u.username
WITH DATA;

-- Unique index required for non-blocking REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_leaderboard_user_id ON mv_leaderboard (user_id);
CREATE INDEX idx_mv_leaderboard_rank ON mv_leaderboard (rank ASC);

-- Stored Procedure for Safe Concurrent Refresh
CREATE OR REPLACE PROCEDURE refresh_leaderboard(p_concurrent BOOLEAN DEFAULT true)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_concurrent THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
    ELSE
        REFRESH MATERIALIZED VIEW mv_leaderboard;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. AUDIT IMMUTABILITY TRIGGER (SECURITY)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: audit_log is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION protect_audit_log();

-- ----------------------------------------------------------------------------
-- 6. LEAST-PRIVILEGE ROLE-BASED ACCESS CONTROL (RBAC)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN
        CREATE ROLE dsa_app WITH LOGIN PASSWORD 'dsa_app_secure_pass';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_worker') THEN
        CREATE ROLE dsa_worker WITH LOGIN PASSWORD 'dsa_worker_secure_pass';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_readonly') THEN
        CREATE ROLE dsa_readonly WITH LOGIN PASSWORD 'dsa_readonly_secure_pass';
    END IF;
END
$$;

-- dsa_app: Fastify REST API permissions
GRANT USAGE ON SCHEMA public TO dsa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dsa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsa_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dsa_app;

-- dsa_worker: Sandboxed submission runner permissions
GRANT USAGE ON SCHEMA public TO dsa_worker;
GRANT SELECT ON problems, test_cases, solutions TO dsa_worker;
GRANT SELECT, UPDATE ON submissions TO dsa_worker;
GRANT SELECT, INSERT, UPDATE ON user_problem_stats TO dsa_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsa_worker;

-- dsa_readonly: Analytics, backup, and Prometheus exporter permissions
GRANT USAGE ON SCHEMA public TO dsa_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dsa_readonly;
