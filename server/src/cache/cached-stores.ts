import type { Cache } from './cache';
import type { LeaderboardRow, LeaderboardStore } from '../modules/leaderboard/store';
import type { DailyChallengeStore } from '../modules/daily/store';

export const LEADERBOARD_TTL_S = 30;
export const DAILY_TTL_S = 300;

/**
 * Cache-aside around Person 1's leaderboard store (CR-022 item 2). Keyed by period: `rows(since)`
 * gets a moving "7 days ago" for the week board, so the exact instant can't be part of the key;
 * a 30 s TTL bounds the staleness. `bumpGeneration('leaderboard')` drops every cached board.
 */
export class CachedLeaderboardStore implements LeaderboardStore {
  constructor(
    private inner: LeaderboardStore,
    private cache: Cache
  ) {}

  async rows(since: Date | null): Promise<LeaderboardRow[]> {
    const key = await this.cache.genKey('leaderboard', since ? 'week' : 'all');
    const rows = await this.cache.getOrLoad(key, LEADERBOARD_TTL_S, () => this.inner.rows(since));
    // JSON turns Dates into strings; rankRows compares them as Dates.
    return rows.map((r) => ({ ...r, lastSolvedAt: new Date(r.lastSolvedAt) }));
  }
}

/** Cache-aside around the daily challenge store: one entry per UTC date (the pick never changes that day). */
export class CachedDailyChallengeStore implements DailyChallengeStore {
  constructor(
    private inner: DailyChallengeStore,
    private cache: Cache
  ) {}

  async getOrCreate(date: string): Promise<string | null> {
    return this.cache.getOrLoad(await this.cache.genKey('daily', date), DAILY_TTL_S, () =>
      this.inner.getOrCreate(date)
    );
  }
}
