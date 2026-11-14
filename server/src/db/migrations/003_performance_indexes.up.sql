-- Migration: 003_performance_indexes
-- Description: Database optimization for 100k+ scale:
--   - Covering index for user submission history (Index-Only Scan)
--   - Partial index for judged submissions activity feed
--   - Partial index for solved submission lookups
--   - Keyset pagination composite index on submissions (created_at DESC, id DESC)
--   - Covering index on published problems catalog
--   - Covering composite index on user_problem_stats
--   - Materialized view mv_leaderboard with unique index for non-blocking CONCURRENT refresh
--   - refresh_leaderboard() management function
-- Author: Person 2
-- Date: 2026-11-14

BEGIN;

-- ============================================================================
-- 1. Covering Index for User Submission History (Index-Only Scan)
-- ============================================================================
-- Eliminates table heap lookups for user history queries (user_id, created_at DESC)
CREATE INDEX idx_submissions_user_history_covering
    ON submissions (user_id, created_at DESC)
    INCLUDE (problem_id, status, passed, total);

COMMENT ON INDEX idx_submissions_user_history_covering IS
'Covering index satisfying user history queries entirely from the index (Index-Only Scan).';

-- ============================================================================
-- 2. Partial Index for Judged Recent Activity Feed (Q9)
-- ============================================================================
-- Substantially speeds up site-wide activity feed by indexing only judged submissions
CREATE INDEX idx_submissions_judged_recent
    ON submissions (created_at DESC)
    WHERE status = 'judged';

COMMENT ON INDEX idx_submissions_judged_recent IS
'Partial index filtering only status = "judged" for instantaneous activity feed retrieval.';

-- ============================================================================
-- 3. Partial Index for Solved Verification (Q10)
-- ============================================================================
-- Reduces index size by only indexing winning/solved submissions
CREATE INDEX idx_submissions_user_problem_solved_partial
    ON submissions (user_id, problem_id, created_at ASC)
    WHERE passed = total AND total > 0;

COMMENT ON INDEX idx_submissions_user_problem_solved_partial IS
'Partial index filtering passed = total AND total > 0 for instant problem-solved checks.';

-- ============================================================================
-- 4. Keyset Pagination Index on Submissions
-- ============================================================================
-- Supports deterministic (created_at, id) cursor navigation with zero offset degradation
CREATE INDEX idx_submissions_keyset_pagination
    ON submissions (created_at DESC, id DESC);

COMMENT ON INDEX idx_submissions_keyset_pagination IS
'Composite B-tree index enabling O(log N) keyset cursor pagination at arbitrary depths.';

-- ============================================================================
-- 5. Covering Index for Problems Catalog (Q1 & Q2)
-- ============================================================================
CREATE INDEX idx_problems_catalog_covering
    ON problems (topic, difficulty, created_at ASC)
    INCLUDE (slug, title)
    WHERE is_published = true;

-- ============================================================================
-- 6. Covering Composite Index on user_problem_stats (Q5 & Q6)
-- ============================================================================
CREATE INDEX idx_ups_user_topic_stats
    ON user_problem_stats (user_id, problem_id)
    INCLUDE (attempts, solved, first_solved_at, last_attempted_at);

-- ============================================================================
-- 7. Materialized View: mv_leaderboard
-- ============================================================================
-- Pre-aggregates solved counts, point scores, and rankings across 100k submissions
CREATE MATERIALIZED VIEW mv_leaderboard AS
SELECT
    u.id AS user_id,
    u.username,
    COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed = s.total AND s.total > 0)::integer AS solved_count,
    COUNT(s.id)::integer AS total_submissions,
    COALESCE(SUM(CASE
        WHEN s.passed = s.total AND s.total > 0 THEN
            CASE p.difficulty
                WHEN 'Easy' THEN 10
                WHEN 'Medium' THEN 25
                WHEN 'Hard' THEN 50
                ELSE 10
            END
        ELSE 0
    END), 0)::integer AS score,
    MAX(s.created_at) AS last_submission_at,
    DENSE_RANK() OVER (
        ORDER BY
            COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed = s.total AND s.total > 0) DESC,
            COALESCE(SUM(CASE
                WHEN s.passed = s.total AND s.total > 0 THEN
                    CASE p.difficulty
                        WHEN 'Easy' THEN 10
                        WHEN 'Medium' THEN 25
                        WHEN 'Hard' THEN 50
                        ELSE 10
                    END
                ELSE 0
            END), 0) DESC,
            MAX(s.created_at) ASC
    )::integer AS rank
FROM users u
JOIN submissions s ON s.user_id = u.id
JOIN problems p ON p.id = s.problem_id
GROUP BY u.id, u.username
HAVING COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed = s.total AND s.total > 0) > 0
WITH DATA;

COMMENT ON MATERIALIZED VIEW mv_leaderboard IS
'Pre-aggregated user rankings and scores. Refreshed concurrently via BullMQ worker.';

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_leaderboard_user_id
    ON mv_leaderboard (user_id);

-- Clustered ranking index for fast Top-N and paginated leaderboard queries
CREATE INDEX idx_mv_leaderboard_rank
    ON mv_leaderboard (rank ASC, score DESC, last_submission_at ASC);

-- ============================================================================
-- 8. Leaderboard Refresh Helper Function
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_leaderboard(p_concurrent BOOLEAN DEFAULT true)
RETURNS void AS $$
BEGIN
    IF p_concurrent THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
    ELSE
        REFRESH MATERIALIZED VIEW mv_leaderboard;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_leaderboard(BOOLEAN) IS
'Refreshes mv_leaderboard concurrently without locking read queries.';

COMMIT;
