import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStore } from 'zustand';
import { tokens, useStats, type StreakDetail } from '@dsa-portal/ui-core';
import { themeMode } from '../theme';

// Categorical pair validated with the dataviz palette checker (CVD + contrast) on both surfaces.
const useColors = () => tokens.color[useStore(themeMode).mode]; // re-renders on any theme change, system included

const pct = (solved: number, attempted: number) =>
  attempted ? `${Math.round((solved / attempted) * 100)}%` : '–';

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
      {sub && <div className="muted">{sub}</div>}
    </div>
  );
}

function AttemptedSolvedChart({
  data,
  category,
  title,
}: {
  data: Array<{ name: string; attempted: number; solved: number }>;
  category: string;
  title: string;
}) {
  const c = useColors();
  return (
    <figure className="card chart" aria-labelledby={`${category}-title`}>
      <figcaption id={`${category}-title`}>
        <h2>{title}</h2>
      </figcaption>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44 + 60)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 24 }}
          barGap={2}
          barCategoryGap="28%"
        >
          <CartesianGrid horizontal={false} stroke={c.border} strokeDasharray="2 4" />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke={c.textMuted}
            tick={{ fill: c.textMuted, fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            stroke={c.textMuted}
            tick={{ fill: c.text, fontSize: 13 }}
          />
          <Tooltip
            cursor={{ fill: c.surface }}
            contentStyle={{
              background: c.surfaceRaised,
              border: `1px solid ${c.border}`,
              color: c.text,
            }}
            formatter={(v: number, name: string) => [v, name]}
            labelFormatter={(name: string) => {
              const row = data.find((d) => d.name === name);
              return row ? `${name} · accuracy ${pct(row.solved, row.attempted)}` : name;
            }}
          />
          <Legend wrapperStyle={{ color: c.text }} />
          <Bar dataKey="attempted" name="Attempted" fill={c.chart2} radius={[0, 4, 4, 0]} />
          <Bar dataKey="solved" name="Solved" fill={c.chart1} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Last 12 weeks, one cell per UTC day; filled = solved a new problem that day. */
function StreakCalendar({ streak }: { streak: StreakDetail }) {
  const solved = new Set(streak.days);
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 83)
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // align to Sunday
  const days: string[] = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return (
    <figure className="card" aria-labelledby="cal-title">
      <figcaption id="cal-title">
        <h2>Streak calendar</h2>
        <p className="muted">
          A day counts when you solve a problem for the first time that day (UTC).
        </p>
      </figcaption>
      <div className="calendar" role="list">
        {days.map((d) => (
          <span
            key={d}
            role="listitem"
            className={`cal-day${solved.has(d) ? ' on' : ''}`}
            title={`${d}: ${solved.has(d) ? 'solved' : 'no new solve'}`}
            aria-label={`${d}: ${solved.has(d) ? 'solved' : 'no new solve'}`}
          />
        ))}
      </div>
    </figure>
  );
}

export function StatsPage() {
  const { summary, streak, loading, error, load } = useStats();

  if (error) {
    return (
      <div className="card narrow" role="alert">
        <p className="error">Could not load your stats: {error}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (loading && !summary) {
    return (
      <div aria-busy="true" aria-label="Loading stats">
        <div className="tiles">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="tile skeleton" />
          ))}
        </div>
        <div className="card chart skeleton" style={{ height: 240 }} />
      </div>
    );
  }
  if (!summary) return null;

  const topics = (summary.topics ?? []).map((t) => ({
    name: t.topic,
    attempted: t.attempted,
    solved: t.solved,
  }));
  const difficulties = (summary.difficulties ?? []).map((d) => ({
    name: d.difficulty,
    attempted: d.attempted,
    solved: d.solved,
  }));
  const s = streak ?? summary.streak;

  return (
    <div className="stats">
      <h1>Your progress</h1>
      <div className="tiles">
        <Tile
          label="Solved"
          value={`${summary.solved}/${summary.totalProblems}`}
          sub={`${pct(summary.solved, summary.totalProblems)} of all problems`}
        />
        <Tile label="Attempted" value={summary.attempted} />
        <Tile
          label="Accuracy"
          value={pct(summary.solved, summary.attempted)}
          sub="solved ÷ attempted"
        />
        <Tile
          label="Current streak"
          value={`${s?.currentStreak ?? 0} d`}
          sub={`longest ${s?.longestStreak ?? 0} d`}
        />
      </div>
      {summary.attempted === 0 ? (
        <p className="card">
          No attempts yet. Solve your first problem and your charts appear here.
        </p>
      ) : (
        <>
          <AttemptedSolvedChart data={topics} category="topic" title="By topic" />
          {difficulties.length > 0 && (
            <AttemptedSolvedChart data={difficulties} category="difficulty" title="By difficulty" />
          )}
          <details className="card">
            <summary>Show as table</summary>
            <table className="results">
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col">Attempted</th>
                  <th scope="col">Solved</th>
                  <th scope="col">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.name}>
                    <th scope="row">{t.name}</th>
                    <td>{t.attempted}</td>
                    <td>{t.solved}</td>
                    <td>{pct(t.solved, t.attempted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {streak && <StreakCalendar streak={streak} />}
    </div>
  );
}
