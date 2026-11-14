-- Migration: 003_performance_indexes (Down)
-- Description: Rolls back performance indexes, materialized view, and refresh function.
-- Author: Person 2
-- Date: 2026-11-14

BEGIN;

DROP FUNCTION IF EXISTS refresh_leaderboard(BOOLEAN);
DROP MATERIALIZED VIEW IF EXISTS mv_leaderboard CASCADE;

DROP INDEX IF EXISTS idx_ups_user_topic_stats;
DROP INDEX IF EXISTS idx_problems_catalog_covering;
DROP INDEX IF EXISTS idx_submissions_keyset_pagination;
DROP INDEX IF EXISTS idx_submissions_user_problem_solved_partial;
DROP INDEX IF EXISTS idx_submissions_judged_recent;
DROP INDEX IF EXISTS idx_submissions_user_history_covering;

COMMIT;
