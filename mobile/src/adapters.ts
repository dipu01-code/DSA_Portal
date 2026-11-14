import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import type { NetworkStatus, SecureStorage } from '@dsa-portal/ui-core';

/** Keychain (iOS) / Keystore-encrypted prefs (Android). Keys may only use [A-Za-z0-9._-]. */
export const secureStorage: SecureStorage = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

export function netInfoStatus(): NetworkStatus {
  let online = true;
  NetInfo.addEventListener((s) => {
    online = s.isConnected !== false && s.isInternetReachable !== false;
  });
  return {
    isOnline: () => online,
    subscribe: (listener) =>
      NetInfo.addEventListener((s) =>
        listener(s.isConnected !== false && s.isInternetReachable !== false)
      ),
  };
}
