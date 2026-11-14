import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@dsa-portal/ui-core';
import { SyncBar } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

/** Everything in (app) needs a signed-in user. */
export default function AppLayout() {
  const { status } = useAuth();
  const { c } = useTheme();
  if (status === 'unknown') {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}
      >
        <ActivityIndicator accessibilityLabel="Loading" color={c.primary} />
      </View>
    );
  }
  if (status === 'anonymous') return <Redirect href="/login" />;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SyncBar />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="problem/[id]" options={{ title: 'Problem' }} />
      </Stack>
    </View>
  );
}
