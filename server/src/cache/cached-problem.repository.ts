import type { Difficulty, Problem, ProblemRepository, Topic } from '@dsa-portal/core';
import type { Cache } from './cache';

export const PROBLEM_TTL_S = 600;
export const PROBLEM_LIST_TTL_S = 300;

/**
 * ProblemRepository decorator: reads go through the cache, writes (admin create/update/delete)
 * invalidate the problem's key and bump the list generation. Routes don't change.
 * shortcut: entries looked up by UUID instead of slug are only refreshed by TTL (clients use slugs).
 */
export class CachedProblemRepository implements ProblemRepository {
  constructor(
    private inner: ProblemRepository,
    private cache: Cache
  ) {}

  findById(id: string) {
    return this.cache.getOrLoad(this.cache.key('problem', id), PROBLEM_TTL_S, () =>
      this.inner.findById(id)
    );
  }

  async findAll(filters: { topic?: Topic; difficulty?: Difficulty } = {}) {
    const key = await this.cache.genKey(
      'problems',
      'list',
      filters.topic ?? '*',
      filters.difficulty ?? '*'
    );
    return this.cache.getOrLoad(key, PROBLEM_LIST_TTL_S, () => this.inner.findAll(filters));
  }

  async save(problem: Problem) {
    await this.inner.save(problem);
    await this.changed(problem.id);
  }

  async delete(id: string) {
    const deleted = await this.inner.delete(id);
    if (deleted) await this.changed(id);
    return deleted;
  }

  private async changed(id: string) {
    await this.cache.invalidate(this.cache.key('problem', id));
    await this.cache.bumpGeneration('problems');
    await this.cache.bumpGeneration('daily'); // the daily challenge embeds the full problem
  }
}
