import { describe, expect, it } from '@jest/globals';
import { PROBLEMS, getProblem, getRandomProblem, listProblems } from '../src/problems';

describe('problems', () => {
  it('loads problems from JSON files', () => {
    expect(PROBLEMS.length).toBeGreaterThan(0);
    expect(PROBLEMS.some((p) => p.id === 'two-sum')).toBe(true);
  });

  it('getProblem returns the correct problem by id', () => {
    const p = getProblem('two-sum');
    expect(p?.title).toBe('Two Sum');
    expect(p?.difficulty).toBe('Easy');
    expect(getProblem('does-not-exist')).toBeUndefined();
  });

  it('getRandomProblem returns a registered problem or null', () => {
    const p = getRandomProblem({ topic: 'Arrays', difficulty: 'Easy' });
    if (p) expect(PROBLEMS.some((r) => r.id === p.id)).toBe(true);
  });

  it('getRandomProblem with no options returns any problem or null', () => {
    const p = getRandomProblem();
    if (p) expect(PROBLEMS.some((r) => r.id === p.id)).toBe(true);
  });

  it('getRandomProblem returns null when no match', () => {
    const p = getRandomProblem({ topic: 'Graphs', difficulty: 'Hard' });
    expect(p).toBeNull();
  });

  it('listProblems returns id, title, topic, difficulty', () => {
    const list = listProblems();
    expect(list.length).toBe(PROBLEMS.length);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('title');
    expect(list[0]).toHaveProperty('topic');
    expect(list[0]).toHaveProperty('difficulty');
  });
});
