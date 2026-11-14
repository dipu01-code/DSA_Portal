import { useEffect } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { describeQueued, useProblem, useSubmissionStatus, useSync } from '@dsa-portal/ui-core';
import { CodeEditor } from '../../../src/components/CodeEditor';
import { Results } from '../../../src/components/Results';
import { Body, Button, Card, ErrorText, H1, H2 } from '../../../src/components/ui';
import { MONO, useTheme } from '../../../src/theme';

export default function ProblemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useProblem();
  const sub = useSubmissionStatus();
  const { c, space } = useTheme();
  const { width } = useWindowDimensions();
  const { queue } = useSync();
  const queued = sub.queuedKey ? queue.find((q) => q.key === sub.queuedKey) : undefined;
  const wide = width >= 768; // tablets / landscape: description and editor side by side

  useEffect(() => {
    if (id && p.problem?.id !== id) void p.load(id);
    sub.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!p.problem) {
    return (
      <View style={{ padding: space.lg }}>
        {p.error ? <ErrorText>{p.error}</ErrorText> : <Body muted>Loading problem…</Body>}
      </View>
    );
  }
  const problem = p.problem;
  const judging = sub.status === 'submitting' || sub.status === 'judging';

  const confirmReveal = () =>
    Alert.alert('Reveal the solution?', 'It unlocks after you solve the problem.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reveal', onPress: () => void p.revealSolution() },
    ]);

  const description = (
    <Card style={wide ? { flex: 2, marginRight: space.lg } : undefined}>
      <H1>{problem.title}</H1>
      <Body muted>
        {problem.difficulty} · {problem.topic}
      </Body>
      <View style={{ height: space.md }} />
      <Body>{problem.description}</Body>
      <H2>Examples</H2>
      {problem.testCases.slice(0, 2).map((t, i) => (
        <Text
          key={i}
          style={{ color: c.text, fontFamily: MONO, fontSize: 13, marginBottom: space.sm }}
        >
          input: {t.input}
          {'\n'}output: {t.expected}
        </Text>
      ))}
      <H2>Hints</H2>
      {p.hints.map((h, i) => (
        <Body key={i}>
          {i + 1}. {h}
        </Body>
      ))}
      <View style={{ marginTop: space.sm }}>
        <Button
          title={
            p.hints.length >= problem.hints.length
              ? 'No more hints'
              : `Show hint ${p.hints.length + 1} of ${problem.hints.length}`
          }
          disabled={p.hints.length >= problem.hints.length}
          onPress={() => void p.nextHint()}
        />
      </View>
      <H2>Solution</H2>
      {p.solution ? (
        <Text selectable style={{ color: c.text, fontFamily: MONO, fontSize: 13 }}>
          {p.solution}
        </Text>
      ) : (
        <Button title="Reveal solution…" onPress={confirmReveal} />
      )}
      {p.error && <ErrorText>{p.error}</ErrorText>}
    </Card>
  );

  const editor = (
    <View style={wide ? { flex: 3 } : undefined}>
      <Card>
        <CodeEditor value={p.code} onChange={p.setCode} minHeight={wide ? 360 : 260} />
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <View style={{ flex: 1 }}>
            <Button
              title={judging ? 'Judging…' : 'Submit'}
              primary
              busy={judging}
              onPress={() => void sub.submit(problem.id, p.code)}
            />
          </View>
          <Button title="Reset" onPress={() => p.setCode(problem.starterCode)} />
        </View>
      </Card>
      <Card>
        <H2>Results</H2>
        {sub.status === 'idle' && (
          <Body muted>Submit to run your code on the server against all test cases.</Body>
        )}
        {judging && (
          <Body muted>
            {sub.current?.status === 'running' ? 'Running…' : 'Queued…'}{' '}
            {sub.live ? '(live)' : '(checking every second)'}
          </Body>
        )}
        {sub.status === 'queued' && (!queued || queued.state === 'pending') && (
          <Body muted>
            You are offline. Your submission is queued on this phone and will be judged when you
            reconnect (see the bar at the top).
          </Body>
        )}
        {sub.status === 'queued' && queued && queued.state !== 'pending' && (
          <Body
            tone={
              queued.state === 'synced'
                ? 'success'
                : queued.state === 'syncing'
                  ? undefined
                  : 'danger'
            }
          >
            {describeQueued(queued)}
            {queued.message ? `. ${queued.message}` : ''}
          </Body>
        )}
        {sub.status === 'error' && <ErrorText>{sub.error}</ErrorText>}
        {sub.status === 'done' && sub.current?.status === 'failed' && (
          <ErrorText>The judge failed to run this submission. Please try again.</ErrorText>
        )}
        {sub.status === 'done' && sub.current?.status === 'judged' && (
          <Results submission={sub.current} />
        )}
      </Card>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <Stack.Screen options={{ title: problem.title }} />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'flex-start' : 'stretch',
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {description}
        {editor}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
