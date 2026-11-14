import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { SecureStorage } from '@dsa-portal/ui-core';

/**
 * SecureStorage backed by Electron safeStorage (Keychain on macOS, DPAPI on Windows, libsecret on
 * Linux). If the OS offers no encryption, secrets are kept in memory only: never written in plain text.
 */
export function safeStorageStore(): SecureStorage {
  const file = (key: string) =>
    path.join(app.getPath('userData'), `${key.replace(/[^\w.-]/g, '_')}.bin`);
  const memory = new Map<string, string>();
  const encrypted = () => safeStorage.isEncryptionAvailable();
  return {
    async get(key) {
      if (!encrypted()) return memory.get(key) ?? null;
      try {
        return safeStorage.decryptString(await fs.promises.readFile(file(key)));
      } catch {
        return null;
      }
    },
    async set(key, value) {
      if (!encrypted()) return void memory.set(key, value);
      await fs.promises.writeFile(file(key), safeStorage.encryptString(value), { mode: 0o600 });
    },
    async remove(key) {
      memory.delete(key);
      await fs.promises.rm(file(key), { force: true });
    },
  };
}
