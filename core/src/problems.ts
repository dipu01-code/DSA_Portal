import * as path from 'path';
import { loadProblems, filterProblems } from './problem-loader';
import { selectRandomProblem } from './random-selector';
import type { Problem, Topic, Difficulty } from './types';

const PROBLEMS_DIR = path.join(__dirname, '..', 'problems');

export const PROBLEMS: Problem[] = loadProblems(PROBLEMS_DIR);

export function getProblem(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}

export function getRandomProblem(options?: {
  topic?: Topic;
  difficulty?: Difficulty;
  recentIds?: string[];
}): Problem | null {
  return selectRandomProblem(PROBLEMS, options ?? {});
}

export function listProblems() {
  return PROBLEMS.map(({ id, title, topic, difficulty }) => ({ id, title, topic, difficulty }));
}

export { filterProblems };
