import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useAuth, useLeaderboard } from '@dsa-portal/ui-core';
import { Body, Button, Card, ErrorText, H1 } from '../../../src/components/ui';
import { useTheme } from '../../../src/theme';

/** Public leaderboard; refreshes on `leaderboard:update` pushes and on pull-to-refresh. */
export default function Leaderboard() {
  const { entries, loading, error, reload, nextCursor, loadMore } = useLeaderboard(50);
  const { user } = useAuth();
  const { c, space } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: space.lg,
        maxWidth: 720,
        width: '100%',
        alignSelf: 'center',
      }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
    >
      <H1>Leaderboard</H1>
      <Body muted>Ranked by problems solved, then score (Easy 1, Medium 2, Hard 3).</Body>
      {error && <ErrorText>Could not load the leaderboard: {error}</ErrorText>}
      {!loading && !error && entries.length === 0 && (
        <Body>No one has solved a problem yet. Be the first!</Body>
      )}
      {entries.length > 0 && (
        <Card style={{ marginTop: space.md, padding: 0 }}>
          {entries.map((e, i) => {
            const me = e.userId === user?.id;
            return (
              <View
                key={e.userId}
                accessible
                accessibilityLabel={`Rank ${e.rank}, ${e.username}${me ? ' (you)' : ''}, ${e.solved} solved, score ${e.totalScore}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: space.md,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: c.border,
                  backgroundColor: me ? c.surfaceRaised : undefined,
                }}
              >
                <Text style={{ width: 44, color: c.text, fontWeight: '700', fontSize: 16 }}>
                  #{e.rank}
                </Text>
                <Text
                  style={{ flex: 1, color: c.text, fontWeight: me ? '700' : '400', fontSize: 16 }}
                >
                  {e.username}
                  {me ? ' (you)' : ''}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 15 }}>
                  {e.solved} solved · {e.totalScore} pts
                </Text>
              </View>
            );
          })}
        </Card>
      )}
      {nextCursor && <Button title="Load more" busy={loading} onPress={() => void loadMore()} />}
    </ScrollView>
  );
}
