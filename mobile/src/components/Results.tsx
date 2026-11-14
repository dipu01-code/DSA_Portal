import { Text, View } from 'react-native';
import type { Submission } from '@dsa-portal/ui-core';
import { MONO, useTheme } from '../theme';
import { Body } from './ui';

/** Per-test-case output of a judged submission. */
export function Results({ submission }: { submission: Submission }) {
  const { c, space } = useTheme();
  const accepted = submission.total > 0 && submission.passed === submission.total;
  return (
    <View accessibilityLiveRegion="polite">
      <Body tone={accepted ? 'success' : 'danger'}>
        {accepted ? 'Accepted' : 'Wrong answer'} · {submission.passed}/{submission.total} passed
      </Body>
      {submission.results?.map((r) => (
        <View
          key={r.testCaseIndex}
          style={{
            borderTopWidth: 1,
            borderColor: c.border,
            paddingVertical: space.sm,
            marginTop: space.xs,
          }}
          accessible
          accessibilityLabel={`Test ${(r.testCaseIndex ?? 0) + 1} ${r.passed ? 'passed' : 'failed'}, expected ${r.expected}, got ${r.actual}`}
        >
          <Text style={{ color: r.passed ? c.success : c.danger, fontWeight: '600' }}>
            #{(r.testCaseIndex ?? 0) + 1} {r.passed ? '✓ pass' : '✗ fail'}
          </Text>
          <Text style={{ color: c.textMuted, fontFamily: MONO, fontSize: 13 }}>
            expected {r.expected}
          </Text>
          <Text style={{ color: c.text, fontFamily: MONO, fontSize: 13 }}>
            actual {r.actual || '(nothing)'}
          </Text>
        </View>
      ))}
    </View>
  );
}
