import type { Difficulty, ProblemRepository, SubmissionRepository, Topic } from '@dsa-portal/core';
import type { DifficultyStat, StatsStore } from './stats.service';

/**
 * Derives stats from the submission and problem repositories, for tests and running without a
 * database. PostgresStatsStore reads the maintained user_problem_stats counters instead.
 */
export class InMemoryStatsRepository implements StatsStore {
  constructor(
    private problems: ProblemRepository,
    private submissions: SubmissionRepository
  ) {}

  /** problemId → first time it was solved (null = attempted, never solved). */
  private async perProblem(userId: string) {
    const map = new Map<string, Date | null>();
    const judged = (await this.submissions.findByUser(userId))
      .filter((s) => s.status === 'judged')
      .sort(
        (a, b) => (a.judgedAt ?? a.createdAt).getTime() - (b.judgedAt ?? b.createdAt).getTime()
      );
    for (const s of judged) {
      if (!map.get(s.problemId)) {
        map.set(s.problemId, s.result?.status === 'passed' ? (s.judgedAt ?? s.createdAt) : null);
      }
    }
    return map;
  }

  private async groupBy<K extends string>(
    userId: string,
    keyOf: (p: { topic: Topic; difficulty: Difficulty }) => K
  ) {
    const per = await this.perProblem(userId);
    const byId = new Map((await this.problems.findAll()).map((p) => [p.id, p]));
    const groups = new Map<K, { attempted: number; solved: number }>();
    for (const [problemId, solvedAt] of per) {
      const p = byId.get(problemId);
      if (!p) continue;
      const g = groups.get(keyOf(p)) ?? { attempted: 0, solved: 0 };
      g.attempted++;
      if (solvedAt) g.solved++;
      groups.set(keyOf(p), g);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }

  async getUserStats(userId: string) {
    const per = await this.perProblem(userId);
    return {
      attempted: per.size,
      solved: [...per.values()].filter(Boolean).length,
      totalProblems: (await this.problems.findAll()).length,
      streak: 0, // unused: the stats API computes streaks from getFirstSolves
    };
  }

  async getTopicStats(userId: string) {
    return (await this.groupBy(userId, (p) => p.topic)).map(([topic, g]) => ({ topic, ...g }));
  }

  async getDifficultyStats(userId: string): Promise<DifficultyStat[]> {
    return (await this.groupBy(userId, (p) => p.difficulty)).map(([difficulty, g]) => ({
      difficulty,
      ...g,
    }));
  }

  async getFirstSolves(userId: string) {
    return [...(await this.perProblem(userId)).values()].filter((d): d is Date => d !== null);
  }
}
