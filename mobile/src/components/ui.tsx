import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { pendingCount, syncSummary, useSync } from '@dsa-portal/ui-core';
import { useTheme } from '../theme';

export function Button(props: {
  title: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const { c, space, radius } = useTheme();
  const off = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      accessibilityHint={props.accessibilityHint}
      onPress={props.onPress}
      disabled={off}
      style={({ pressed }) => ({
        minHeight: 48, // touch target
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: props.primary ? c.primary : c.border,
        backgroundColor: props.primary ? c.primary : c.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {props.busy ? (
        <ActivityIndicator color={props.primary ? c.onPrimary : c.text} />
      ) : (
        <Text
          style={{ color: props.primary ? c.onPrimary : c.text, fontWeight: '600', fontSize: 16 }}
        >
          {props.title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { c, space, radius } = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={{ color: c.text, fontWeight: '500', marginBottom: space.xs }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        style={[
          {
            minHeight: 48,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: c.text,
            backgroundColor: c.surfaceRaised,
            fontSize: 16,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function Chip(props: { label: string; selected: boolean; onPress(): void }) {
  const { c, space, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: props.selected ? c.primary : c.border,
        backgroundColor: props.selected ? c.primary : c.surfaceRaised,
        margin: space.xs,
      }}
    >
      <Text style={{ color: props.selected ? c.onPrimary : c.text, fontWeight: '500' }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const { c, space, radius } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: space.lg,
          marginBottom: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: 24, fontWeight: '700', marginBottom: 12 }}
    >
      {children}
    </Text>
  );
}
export function H2({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 }}
    >
      {children}
    </Text>
  );
}
export function Body({
  children,
  muted,
  tone,
}: {
  children: ReactNode;
  muted?: boolean;
  tone?: 'success' | 'danger';
}) {
  const { c } = useTheme();
  return (
    <Text
      style={{ color: tone ? c[tone] : muted ? c.textMuted : c.text, fontSize: 16, lineHeight: 22 }}
    >
      {children}
    </Text>
  );
}
export function ErrorText({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: c.danger, marginVertical: 8, fontSize: 15 }}
    >
      {children}
    </Text>
  );
}

/** Connection + offline outbox at the top of every signed-in screen; hidden when online with nothing queued. */
export function SyncBar() {
  const { c, space } = useTheme();
  const sync = useSync();
  const n = pendingCount(sync);
  const needsAttention = sync.queue.some((q) => q.state === 'conflict' || q.state === 'rejected');
  if (sync.status === 'online' && !n && !needsAttention) return null;
  const tone =
    sync.status === 'error' || needsAttention
      ? c.danger
      : sync.status === 'offline'
        ? c.warning
        : c.primary;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: c.surfaceRaised,
          borderColor: tone,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        },
      ]}
    >
      <Text style={{ color: c.text, flex: 1 }}>
        {sync.status === 'offline' ? '○ ' : sync.status === 'syncing' ? '↻ ' : '● '}
        {syncSummary(sync)}
        {sync.status === 'offline' ? '. Opened problems still work; submissions wait here.' : ''}
        {sync.lastError ? ` ${sync.lastError}` : needsAttention ? ' See Settings for details.' : ''}
      </Text>
      {n > 0 && sync.status !== 'syncing' && (
        <Button
          title="Sync now"
          disabled={sync.status === 'offline'}
          onPress={() => void sync.syncNow()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ banner: { borderBottomWidth: 2, padding: 10 } });
