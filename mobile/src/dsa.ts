import { Platform } from 'react-native';
import { openDatabaseAsync } from 'expo-sqlite';
import {
  createDsa,
  nativeRefresh,
  REFRESH_TOKEN_KEY,
  withProblemCache,
  type LocalStore,
} from '@dsa-portal/ui-core';
import { netInfoStatus, secureStorage } from './adapters';
import { sqliteKv, sqliteLocalStore } from './local-store';

// The Android emulator reaches the host computer at 10.0.2.2.
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000')
).replace(/\/$/, '');

let db: ReturnType<typeof openDatabaseAsync> | null = null;
const openDb = () => (db ??= openDatabaseAsync('dsa.db'));
let store: Promise<LocalStore> | null = null;
// Problems the user opens are cached in SQLite and readable offline; judging always needs the server.
const localStore = () => (store ??= openDb().then(sqliteLocalStore));

export const dsa = createDsa({
  baseUrl: API_URL,
  // No cookie jar we control: the refresh token lives in SecureStore and goes out as a Cookie header.
  refresh: nativeRefresh(API_URL, secureStorage),
  onTokens: (t) => secureStorage.set(REFRESH_TOKEN_KEY, t.refreshToken),
  async onLogout() {
    const token = await secureStorage.get(REFRESH_TOKEN_KEY);
    await secureStorage.remove(REFRESH_TOKEN_KEY);
    if (token) {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { cookie: `refresh_token=${token}` },
      }).catch(() => {});
    }
  },
  wrapApi: (http) => withProblemCache(http, localStore),
  settingsStorage: sqliteKv(openDb), // theme + offline submission outbox survive restarts
  network: netInfoStatus(),
  realtimeUrl: API_URL, // Socket.IO for live results; polling takes over while it is down
});
