import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { EDITOR_KEYS, insertAt, straightenQuotes } from '../editor';
import { MONO, useTheme } from '../theme';

/**
 * Native TextInput editor (see docs/design/mobile-editor-decision.md): monospace, no autocorrect or
 * capitalisation, curly quotes straightened, and a key bar for symbols that are hard to reach.
 */
export function CodeEditor({
  value,
  onChange,
  minHeight = 260,
}: {
  value: string;
  onChange(v: string): void;
  minHeight?: number;
}) {
  const { c, space, radius } = useTheme();
  const sel = useRef({ start: value.length, end: value.length });
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();

  const insert = (text: string) => {
    const next = insertAt(value, sel.current, text);
    onChange(next.value);
    sel.current = { start: next.cursor, end: next.cursor };
    setSelection(sel.current); // move the cursor once, then let the user drive it again
    setTimeout(() => setSelection(undefined), 0);
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: c.bg,
      }}
    >
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        style={{ borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
        accessibilityLabel="Symbol keys"
      >
        {EDITOR_KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => insert(k)}
            accessibilityRole="button"
            accessibilityLabel={k === '  ' ? 'Indent' : `Insert ${k}`}
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.sm,
            }}
          >
            <Text style={{ color: c.text, fontFamily: MONO, fontSize: 16 }}>
              {k === '  ' ? '⇥' : k}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        accessibilityLabel="Code editor"
        value={value}
        onChangeText={(t) => onChange(straightenQuotes(t))}
        onSelectionChange={(e) => (sel.current = e.nativeEvent.selection)}
        selection={selection}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
        textAlignVertical="top"
        style={{
          minHeight,
          padding: space.md,
          color: c.text,
          fontFamily: Platform.OS === 'ios' ? MONO : 'monospace',
          fontSize: 14,
          lineHeight: 20,
        }}
      />
    </View>
  );
}
