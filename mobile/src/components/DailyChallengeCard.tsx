import { router } from 'expo-router';
import { useDailyChallenge } from '@dsa-portal/ui-core';
import { Body, Button, Card, H2 } from './ui';

/** Today's problem on the Practice tab; hidden while offline or when the server has none. */
export function DailyChallengeCard() {
  const { daily, loading } = useDailyChallenge();
  if (loading || !daily) return null;
  return (
    <Card>
      <H2>Daily challenge · {daily.date}</H2>
      <Body>{daily.problem.title}</Body>
      <Body muted>
        {daily.problem.difficulty} · {daily.problem.topic}
      </Body>
      <Button
        title="Solve today's challenge"
        primary
        onPress={() => router.push(`/problem/${encodeURIComponent(daily.problemId)}`)}
      />
    </Card>
  );
}
