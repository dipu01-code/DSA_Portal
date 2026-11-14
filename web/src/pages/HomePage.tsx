import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useDsa,
  useProblem,
  useSync,
  type Difficulty,
  type ProblemSummary,
} from '@dsa-portal/ui-core';
import { desktop } from '../platform';
import { DailyChallengeCard } from '../components/DailyChallengeCard';

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

/** Topic + difficulty selection, then a random matching problem (like the original CLI). */
export function HomePage() {
  const { api, stores } = useDsa();
  const { topic, difficulty, setFilters, loadRandom, loading, error } = useProblem();
  const { online } = useSync();
  const [topics, setTopics] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<ProblemSummary[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const navigate = useNavigate();
  const topicRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setTopicsError(null);
    api.topics().then(setTopics, (e: Error) => setTopicsError(e.message));
  }, [api, online]);
  // Browser offline: list what this device has (desktop bundles every problem, so it just keeps the picker).
  useEffect(() => {
    if (online || desktop) return setSaved(null);
    api.problems({ topic: topic ?? undefined, difficulty: difficulty ?? undefined }).then(
      (p) => setSaved(p.data),
      () => setSaved([])
    );
  }, [api, online, topic, difficulty]);
  // Cmd/Ctrl+K (desktop menu) jumps here and focuses the topic picker.
  useEffect(() => desktop?.onMenu((a) => a === 'switch-topic' && topicRef.current?.focus()), []);
  // Focus the picker once when it first fills; refetches after a reconnect must not steal focus.
  const focused = useRef(false);
  useEffect(() => {
    if (topics && !focused.current) {
      focused.current = true;
      topicRef.current?.focus();
    }
  }, [topics]);

  const start = async () => {
    await loadRandom();
    const { problem, error: failed } = stores.problem.getState();
    if (problem && !failed) navigate(`/problem/${encodeURIComponent(problem.id)}`);
  };

  return (
    <>
      <DailyChallengeCard />
      <section className="card narrow" aria-labelledby="pick-title">
        <h1 id="pick-title">Practice</h1>
        <p className="muted">Pick a topic and difficulty, and get a random problem.</p>
        {topicsError && (
          <p role="alert" className="error">
            {topicsError}
          </p>
        )}
        <label>
          Topic
          <select
            ref={topicRef}
            value={topic ?? ''}
            onChange={(e) => setFilters(e.target.value || null, difficulty)}
            disabled={!topics}
          >
            <option value="">Any topic</option>
            {topics?.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Difficulty</legend>
          <div className="row">
            {[null, ...DIFFICULTIES].map((d) => (
              <label key={d ?? 'any'} className="chip">
                <input
                  type="radio"
                  name="difficulty"
                  checked={difficulty === d}
                  onChange={() => setFilters(topic, d)}
                />
                {d ?? 'Any'}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" onClick={start} disabled={loading}>
          {loading ? 'Finding a problem…' : 'Start'}
        </button>
      </section>
      {saved && (
        <section className="card narrow" aria-labelledby="saved-title">
          <h2 id="saved-title">On this device</h2>
          {saved.length === 0 ? (
            <p className="muted">
              No saved problems match. Problems you open while online are kept for offline reading.
            </p>
          ) : (
            <ul>
              {saved.map((p) => (
                <li key={p.id}>
                  <Link to={`/problem/${encodeURIComponent(p.id)}`}>{p.title}</Link>{' '}
                  <span className={`badge ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
