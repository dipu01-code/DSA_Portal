import { describe, expect, it } from '@jest/globals';
import { selectRandomProblem } from '../src/random-selector';
import type { Problem, Topic, Difficulty } from '../src/types';

const makeProblem = (id: string, topic: Topic, difficulty: Difficulty): Problem => ({
  id,
  title: `Problem ${id}`,
  topic,
  difficulty,
  description: 'desc',
  starterCode: 'function solve(input) { return input; }',
  testCases: [{ input: 1, expected: 1 }],
  hints: [{ level: 1, content: 'hint' }],
  solution: { code: 'function solve(input) { return input; }' },
});

describe('random-selector', () => {
  it('returns a problem matching topic + difficulty', () => {
    const problems = [makeProblem('p1', 'Arrays', 'Easy'), makeProblem('p2', 'Strings', 'Medium')];
    const p = selectRandomProblem(problems, { topic: 'Arrays', difficulty: 'Easy' });
    expect(p).not.toBeNull();
    expect(p?.topic).toBe('Arrays');
    expect(p?.difficulty).toBe('Easy');
  });

  it('returns null when no problem matches filters', () => {
    const problems = [makeProblem('p1', 'Arrays', 'Easy')];
    const p = selectRandomProblem(problems, { topic: 'Graphs', difficulty: 'Hard' });
    expect(p).toBeNull();
  });

  it('avoids recently seen problems when possible', () => {
    const problems = [makeProblem('p1', 'Arrays', 'Easy'), makeProblem('p2', 'Arrays', 'Easy')];
    const p = selectRandomProblem(problems, {
      topic: 'Arrays',
      difficulty: 'Easy',
      recentIds: ['p1'],
    });
    expect(p?.id).toBe('p2');
  });

  it('falls back to eligible pool when all were recently seen', () => {
    const problems = [makeProblem('p1', 'Arrays', 'Easy')];
    const p = selectRandomProblem(problems, {
      topic: 'Arrays',
      difficulty: 'Easy',
      recentIds: ['p1'],
    });
    expect(p?.id).toBe('p1');
  });

  it('returns null for empty problem list', () => {
    const p = selectRandomProblem([], { topic: 'Arrays', difficulty: 'Easy' });
    expect(p).toBeNull();
  });
});
