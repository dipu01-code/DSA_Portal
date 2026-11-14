import { useAuth, useLeaderboard } from '@dsa-portal/ui-core';

/** Public leaderboard; refreshes itself when the server pushes `leaderboard:update`. */
export function LeaderboardPage() {
  const { entries, loading, error, reload, nextCursor, loadMore } = useLeaderboard(50);
  const { user } = useAuth();
  return (
    <section className="card" aria-labelledby="lb-title">
      <div className="row">
        <h1 id="lb-title">Leaderboard</h1>
        <span className="spacer" />
        <button type="button" onClick={reload}>
          Refresh
        </button>
      </div>
      <p className="muted">Ranked by problems solved, then score (Easy 1, Medium 2, Hard 3).</p>
      {error && (
        <p role="alert" className="error">
          Could not load the leaderboard: {error}
        </p>
      )}
      {loading && entries.length === 0 && (
        <div aria-busy="true">
          <span className="sr-only" role="status">
            Loading…
          </span>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <p>No one has solved a problem yet. Be the first!</p>
      )}
      {entries.length > 0 && (
        <table className="results">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">User</th>
              <th scope="col">Solved</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.userId}
                aria-current={e.userId === user?.id ? 'true' : undefined}
                className={e.userId === user?.id ? 'me' : undefined}
              >
                <td>{e.rank}</td>
                <th scope="row">
                  {e.username}
                  {e.userId === user?.id ? ' (you)' : ''}
                </th>
                <td>{e.solved}</td>
                <td>{e.totalScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nextCursor && (
        <div className="row end">
          <button type="button" onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
