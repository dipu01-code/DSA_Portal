import { ScrollView, Text, View } from 'react-native';
import {
  describeQueued,
  pendingCount,
  syncSummary,
  useSettings,
  useSync,
} from '@dsa-portal/ui-core';
import { Body, Button, Card, Chip, ErrorText, H1, H2 } from '../../../src/components/ui';
import { useTheme } from '../../../src/theme';

const THEMES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
] as const;

/** Theme and sync status: what is queued on this phone, what synced, and any conflict. */
export default function Settings() {
  const { c, space } = useTheme();
  const { theme, setTheme } = useSettings();
  const sync = useSync();
  const n = pendingCount(sync);
  const finished = sync.queue.length - n;
  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: space.lg,
        maxWidth: 720,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <H1>Settings</H1>
      <Card>
        <H2>Theme</H2>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap' }}
          accessibilityRole="radiogroup"
          accessibilityLabel="Theme"
        >
          {THEMES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={theme === value}
              onPress={() => setTheme(value)}
            />
          ))}
        </View>
      </Card>
      <Card>
        <H2>Sync</H2>
        <Body>{syncSummary(sync)}</Body>
        {sync.lastSyncedAt && (
          <Body muted>Last synced {new Date(sync.lastSyncedAt).toLocaleString()}</Body>
        )}
        {sync.lastError && <ErrorText>{sync.lastError}</ErrorText>}
        {sync.queue.length === 0 && (
          <Body muted>Nothing queued. Submissions made offline wait here until you reconnect.</Body>
        )}
        {sync.queue.map((q) => (
          <View
            key={q.key}
            accessible
            accessibilityLabel={`${q.problemId}: ${describeQueued(q)}${q.message ? `. ${q.message}` : ''}`}
            style={{
              borderTopWidth: 1,
              borderColor: c.border,
              paddingVertical: space.sm,
              marginTop: space.xs,
            }}
          >
            <Text style={{ color: c.text, fontWeight: '600' }}>{q.problemId}</Text>
            <Text
              style={{
                color:
                  q.state === 'conflict' || q.state === 'rejected'
                    ? c.danger
                    : q.state === 'synced'
                      ? c.success
                      : c.textMuted,
              }}
            >
              {describeQueued(q)}
            </Text>
            {q.message && <Text style={{ color: c.textMuted }}>{q.message}</Text>}
            <Text style={{ color: c.textMuted, fontSize: 13 }}>
              Queued {new Date(q.queuedAt).toLocaleString()}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Sync now"
              primary
              busy={sync.status === 'syncing'}
              disabled={sync.status === 'offline' || n === 0}
              onPress={() => void sync.syncNow()}
            />
          </View>
          {finished > 0 && <Button title="Clear finished" onPress={sync.clearFinished} />}
        </View>
      </Card>
    </ScrollView>
  );
}
