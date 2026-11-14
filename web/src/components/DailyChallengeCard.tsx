import { useNavigate } from 'react-router-dom';
import { useDailyChallenge } from '@dsa-portal/ui-core';

/** Today's problem; hidden while offline or when the server has none. */
export function DailyChallengeCard() {
  const { daily, loading } = useDailyChallenge();
  const navigate = useNavigate();
  if (loading || !daily) return null;
  const p = daily.problem;
  return (
    <aside className="card narrow" aria-labelledby="daily-title">
      <h2 id="daily-title">Daily challenge · {daily.date}</h2>
      <p>
        <strong>{p.title}</strong>{' '}
        <span className={`badge ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>{' '}
        <span className="badge">{p.topic}</span>
      </p>
      <button
        type="button"
        className="primary"
        onClick={() => navigate(`/problem/${encodeURIComponent(daily.problemId)}`)}
      >
        Solve today&apos;s challenge
      </button>
    </aside>
  );
}
