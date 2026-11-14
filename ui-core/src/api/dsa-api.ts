import type { components, operations } from './schema';
import type { ApiClient } from './client';

type S = components['schemas'];
type Json<Op extends keyof operations, Code extends number> =
  operations[Op]['responses'] extends Record<Code, { content: { 'application/json': infer B } }>
    ? B
    : never;

export type User = S['User'];
export type TokenPair = S['TokenPair'];
export type Problem = S['Problem'];
export type ProblemSummary = S['ProblemSummary'];
export type Submission = S['Submission'];
export type TopicStat = S['TopicStat'];
export type StreakStat = S['StreakStat'];
export type LeaderboardEntry = S['LeaderboardEntry'];
export type DailyChallenge = S['DailyChallenge'];
export type Difficulty = Problem['difficulty'];
export type Page<T> = { data: T[]; nextCursor: string | null };
// CR-016 (not in openapi.yaml yet): extra stats fields served by Person 3's stats module.
export type DifficultyStat = { difficulty: Difficulty; attempted: number; solved: number };
export type StatsMe = Json<'statsMe', 200> & {
  streak?: StreakStat;
  topics?: TopicStat[];
  difficulties?: DifficultyStat[];
};
export type StreakDetail = StreakStat & { days: string[] };

/**
 * Every call the clients make. The stores depend on this interface only, so the desktop app can
 * route some calls to its offline engine without the UI knowing.
 */
export interface DsaApi {
  register(body: { username: string; email: string; password: string }): Promise<User>;
  /** Stores the access token in the client. `refreshToken` is for native platforms to keep. */
  login(body: { email: string; password: string }): Promise<TokenPair>;
  logout(): Promise<void>;
  me(): Promise<User>;
  topics(): Promise<string[]>;
  problems(q?: {
    topic?: string;
    difficulty?: Difficulty;
    cursor?: string;
    limit?: number;
  }): Promise<Page<ProblemSummary>>;
  randomProblem(q?: { topic?: string; difficulty?: Difficulty }): Promise<Problem>;
  problem(id: string): Promise<Problem>;
  hints(id: string, upto: number): Promise<string[]>;
  solution(id: string): Promise<string>;
  submit(
    body: { problemId: string; code: string },
    idempotencyKey?: string
  ): Promise<{ submissionId: string; status: string }>;
  submission(id: string): Promise<Submission>;
  submissions(q?: {
    problemId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<Submission>>;
  stats(): Promise<StatsMe>;
  topicStats(): Promise<TopicStat[]>;
  streak(): Promise<StreakDetail>;
  leaderboard(q?: { cursor?: string; limit?: number }): Promise<Page<LeaderboardEntry>>;
  dailyChallenge(): Promise<DailyChallenge>;
}

const V1 = '/api/v1';
const enc = encodeURIComponent;

export function createHttpApi(client: ApiClient): DsaApi {
  const { request } = client;
  return {
    register: (body) => request('POST', `${V1}/auth/register`, { body, auth: false }),
    async login(body) {
      const tokens = await request<TokenPair>('POST', `${V1}/auth/login`, { body, auth: false });
      client.setAccessToken(tokens.accessToken);
      return tokens;
    },
    async logout() {
      try {
        await request('POST', `${V1}/auth/logout`, { auth: false });
      } finally {
        client.setAccessToken(null);
      }
    },
    me: () => request('GET', `${V1}/auth/me`),
    topics: async () =>
      (await request<{ topics: string[] }>('GET', `${V1}/topics`, { auth: false })).topics,
    problems: (query) => request('GET', `${V1}/problems`, { query }),
    randomProblem: (query) => request('GET', `${V1}/problems/random`, { query }),
    problem: (id) => request('GET', `${V1}/problems/${enc(id)}`),
    hints: async (id, upto) =>
      (
        await request<{ hints: string[] }>('GET', `${V1}/problems/${enc(id)}/hints`, {
          query: { upto },
        })
      ).hints,
    solution: async (id) =>
      (await request<{ solution: string }>('GET', `${V1}/problems/${enc(id)}/solution`)).solution,
    submit: (body, key) =>
      request('POST', `${V1}/submissions`, {
        body,
        headers: key ? { 'idempotency-key': key } : {},
      }),
    submission: (id) => request('GET', `${V1}/submissions/${enc(id)}`),
    submissions: (query) => request('GET', `${V1}/submissions`, { query }),
    stats: () => request('GET', `${V1}/stats/me`),
    topicStats: async () =>
      (await request<{ topics: TopicStat[] }>('GET', `${V1}/stats/me/topics`)).topics,
    streak: () => request('GET', `${V1}/stats/me/streak`),
    leaderboard: (query) => request('GET', `${V1}/leaderboard`, { query }),
    dailyChallenge: () => request('GET', `${V1}/daily-challenge`),
  };
}
