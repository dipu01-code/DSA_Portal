import type { LeaderboardEntry, Problem, User } from '../api/dsa-api';

export const mockUser: User = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'demo',
  email: 'demo@dsa.dev',
  role: 'user',
  createdAt: '2026-11-01T09:00:00.000Z',
};
export const MOCK_PASSWORD = 'demo-pass-1';

const problem = (
  p: Partial<Problem> & Pick<Problem, 'id' | 'title' | 'topic' | 'difficulty'>
): Problem => ({
  description: `${p.title}: see the examples.`,
  starterCode: 'function solve(input) {\n  // your code\n}\n',
  testCases: [{ input: '{"x":1}', expected: '1' }],
  hints: ['Think about the brute force first.', 'Can a hash map help?', 'One pass is enough.'],
  solution: 'function solve({ x }) { return x; }',
  ...p,
});

export const mockProblems: Problem[] = [
  problem({
    id: 'two-sum',
    title: 'Two Sum',
    topic: 'Arrays',
    difficulty: 'Easy',
    description:
      'Given `nums` and `target`, return the indices of the two numbers that add up to `target`.',
    starterCode: 'function solve({ nums, target }) {\n  // return [i, j]\n}\n',
    testCases: [
      { input: '{"nums":[2,7,11,15],"target":9}', expected: '[0,1]' },
      { input: '{"nums":[3,2,4],"target":6}', expected: '[1,2]' },
    ],
  }),
  problem({ id: 'valid-anagram', title: 'Valid Anagram', topic: 'Strings', difficulty: 'Easy' }),
  problem({
    id: 'longest-substring',
    title: 'Longest Substring Without Repeating Characters',
    topic: 'Strings',
    difficulty: 'Medium',
  }),
  problem({
    id: 'number-of-islands',
    title: 'Number of Islands',
    topic: 'Graphs',
    difficulty: 'Medium',
  }),
  problem({
    id: 'edit-distance',
    title: 'Edit Distance',
    topic: 'Dynamic Programming',
    difficulty: 'Hard',
  }),
];

export const mockTopics = [
  'Arrays',
  'Strings',
  'LinkedList',
  'Trees',
  'Graphs',
  'Dynamic Programming',
  'Sorting',
  'Searching',
];

export const mockLeaderboard: LeaderboardEntry[] = [
  {
    userId: '00000000-0000-4000-8000-0000000000a1',
    username: 'ada',
    solved: 31,
    totalScore: 940,
    rank: 1,
  },
  {
    userId: '00000000-0000-4000-8000-0000000000a2',
    username: 'linus',
    solved: 27,
    totalScore: 800,
    rank: 2,
  },
  { userId: mockUser.id, username: mockUser.username, solved: 3, totalScore: 60, rank: 3 },
];
