import { RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useStats } from '@dsa-portal/ui-core';
import { Body, Button, Card, ErrorText, H1, H2 } from '../../../src/components/ui';
import { useTheme } from '../../../src/theme';

const pct = (s: number, a: number) => (a ? `${Math.round((s / a) * 100)}%` : '–');

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { c, space, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        margin: space.xs,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
      }}
    >
      <Text style={{ color: c.text, fontSize: 26, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.textMuted, fontWeight: '500' }}>{label}</Text>
      {sub && <Text style={{ color: c.textMuted, fontSize: 13 }}>{sub}</Text>}
    </View>
  );
}

/** Attempted vs solved as paired bars, with the numbers written out (no colour-only meaning). */
function Bars({ rows }: { rows: Array<{ name: string; attempted: number; solved: number }> }) {
  const { c, space } = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.attempted));
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: space.lg, marginBottom: space.sm }}>
        <Text style={{ color: c.text }}>
          <Text style={{ color: c.chart2 }}>■</Text> Attempted
        </Text>
        <Text style={{ color: c.text }}>
          <Text style={{ color: c.chart1 }}>■</Text> Solved
        </Text>
      </View>
      {rows.map((r) => (
        <View
          key={r.name}
          accessible
          accessibilityLabel={`${r.name}: ${r.solved} solved of ${r.attempted} attempted, accuracy ${pct(r.solved, r.attempted)}`}
          style={{ marginBottom: space.md }}
        >
          <Text style={{ color: c.text, fontWeight: '500' }}>
            {r.name} · {r.solved}/{r.attempted} · {pct(r.solved, r.attempted)}
          </Text>
          <View
            style={{
              height: 10,
              width: `${(r.attempted / max) * 100}%`,
              backgroundColor: c.chart2,
              borderRadius: 4,
              marginTop: 4,
            }}
          />
          <View
            style={{
              height: 10,
              width: `${(r.solved / max) * 100}%`,
              backgroundColor: c.chart1,
              borderRadius: 4,
              marginTop: 2,
            }}
          />
        </View>
      ))}
    </View>
  );
}

function Calendar({ days }: { days: string[] }) {
  const { c } = useTheme();
  const on = new Set(days);
  const today = new Date();
  const cells: string[] = [];
  for (let i = 83; i >= 0; i--)
    cells.push(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
        .toISOString()
        .slice(0, 10)
    );
  return (
    <ScrollView horizontal accessibilityLabel={`Streak calendar, ${days.length} solve days`}>
      <View style={{ flexDirection: 'column', flexWrap: 'wrap', height: 7 * 17 }}>
        {cells.map((d) => (
          <View
            key={d}
            style={{
              width: 14,
              height: 14,
              margin: 1.5,
              borderRadius: 3,
              borderWidth: 1,
              borderColor: on.has(d) ? c.chart1 : c.border,
              backgroundColor: on.has(d) ? c.chart1 : c.bg,
            }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

export default function Stats() {
  const { summary, streak, loading, error, load } = useStats();
  const { c, space } = useTheme();
  const { width } = useWindowDimensions();
  const s = streak ?? summary?.streak;

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: space.lg,
        maxWidth: width >= 768 ? 900 : undefined,
        width: '100%',
        alignSelf: 'center',
      }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <H1>Your progress</H1>
      {error && (
        <Card>
          <ErrorText>Could not load your stats: {error}</ErrorText>
          <Button title="Try again" onPress={() => void load()} />
        </Card>
      )}
      {!summary && loading && <Body muted>Loading stats…</Body>}
      {summary && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.md }}>
            <Tile label="Solved" value={`${summary.solved}/${summary.totalProblems}`} />
            <Tile label="Attempted" value={String(summary.attempted)} />
            <Tile
              label="Accuracy"
              value={pct(summary.solved, summary.attempted)}
              sub="solved ÷ attempted"
            />
            <Tile
              label="Streak"
              value={`${s?.currentStreak ?? 0} d`}
              sub={`longest ${s?.longestStreak ?? 0} d`}
            />
          </View>
          {summary.attempted === 0 ? (
            <Card>
              <Body>No attempts yet. Solve your first problem and your charts appear here.</Body>
            </Card>
          ) : (
            <>
              <Card>
                <H2>By topic</H2>
                <Bars
                  rows={(summary.topics ?? []).map((t) => ({
                    name: t.topic,
                    attempted: t.attempted,
                    solved: t.solved,
                  }))}
                />
              </Card>
              {(summary.difficulties?.length ?? 0) > 0 && (
                <Card>
                  <H2>By difficulty</H2>
                  <Bars
                    rows={summary.difficulties!.map((d) => ({
                      name: d.difficulty,
                      attempted: d.attempted,
                      solved: d.solved,
                    }))}
                  />
                </Card>
              )}
            </>
          )}
          {streak && (
            <Card>
              <H2>Streak calendar</H2>
              <Body muted>A day counts when you first solve a problem that day (UTC).</Body>
              <Calendar days={streak.days} />
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
