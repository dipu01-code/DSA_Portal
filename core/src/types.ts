export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type Topic =
  | 'Arrays'
  | 'Strings'
  | 'LinkedList'
  | 'Trees'
  | 'Graphs'
  | 'Dynamic Programming'
  | 'Sorting'
  | 'Searching';

export interface TestCase {
  id?: string;
  input: unknown;
  expected: unknown;
}

export interface Hint {
  level: number;
  content: string;
}

export interface Solution {
  code: string;
  explanation?: string;
}

export interface Problem {
  id: string;
  title: string;
  topic: Topic;
  difficulty: Difficulty;
  description: string;
  starterCode: string;
  testCases: TestCase[];
  hints: Hint[];
  solution: Solution;
}

export interface PerTestResult {
  id: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  runtimeMs: number;
  error?: string;
  output?: string;
}

export interface ExecutionResult {
  problemId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  perTest: PerTestResult[];
}

export interface Submission {
  id: string;
  problemId: string;
  userId: string;
  code: string;
  status: 'queued' | 'running' | 'judged' | 'failed';
  result?: ExecutionResult;
  createdAt: Date;
  judgedAt?: Date;
  /** Client Idempotency-Key from POST /submissions; unique per user. */
  idempotencyKey?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
}

/**
 * Storage interfaces — Person 2 implements these for PostgreSQL and SQLite.
 * Do NOT implement here; core remains a pure library with no DB dependency.
 */
export interface ProblemRepository {
  findById(id: string): Promise<Problem | null>;
  findAll(filters?: { topic?: Topic; difficulty?: Difficulty }): Promise<Problem[]>;
  save(problem: Problem): Promise<void>;
  /** Soft delete (unpublish): hidden from lists, kept for existing submissions and stats. False if unknown. */
  delete(id: string): Promise<boolean>;
}

export interface SubmissionRepository {
  save(submission: Submission): Promise<void>;
  findById(id: string): Promise<Submission | null>;
  findByUser(userId: string): Promise<Submission[]>;
  findByIdempotencyKey(userId: string, key: string): Promise<Submission | null>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface StatsRepository {
  getUserStats(userId: string): Promise<{
    attempted: number;
    solved: number;
    totalProblems: number;
    streak: number;
  }>;
  getTopicStats(userId: string): Promise<
    Array<{
      topic: Topic;
      attempted: number;
      solved: number;
    }>
  >;
}
