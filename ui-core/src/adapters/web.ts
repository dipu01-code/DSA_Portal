import type { NetworkStatus, Notifications, SecureStorage } from './types';

/**
 * Browsers have no secure storage that XSS can't read, so the web client keeps nothing secret:
 * the refresh token is an HttpOnly cookie and the access token lives in memory only.
 */
export function memorySecureStorage(): SecureStorage {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
}

export function webNetworkStatus(w: Window = window): NetworkStatus {
  return {
    isOnline: () => w.navigator.onLine,
    subscribe(listener) {
      const on = () => listener(true);
      const off = () => listener(false);
      w.addEventListener('online', on);
      w.addEventListener('offline', off);
      return () => {
        w.removeEventListener('online', on);
        w.removeEventListener('offline', off);
      };
    },
  };
}

// shortcut: browser notifications are not used yet (Day 7 adds Expo ones); this keeps the interface complete.
export const noopNotifications: Notifications = {
  schedule: async () => {},
  cancel: async () => {},
};
