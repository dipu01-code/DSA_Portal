import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopBridge } from '@dsa-portal/ui-core';
import { CONFIG_SYNC, EVENTS, type InvokeChannel } from './ipc-channels';

// Only these typed functions cross into the page: no ipcRenderer, no Node, no generic "send".
const invoke = <T>(channel: InvokeChannel, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;
const on = <T>(channel: string, listener: (v: T) => void) => {
  const handler = (_e: IpcRendererEvent, v: T) => listener(v);
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
};
const config = ipcRenderer.sendSync(CONFIG_SYNC) as { apiBaseUrl: string };

const bridge: DesktopBridge = {
  apiBaseUrl: config.apiBaseUrl,
  auth: {
    saveRefreshToken: (t) => invoke('auth:save-refresh-token', t),
    refresh: () => invoke('auth:refresh'),
    logout: () => invoke('auth:logout'),
  },
  network: {
    isOnline: () => invoke('network:is-online'),
    onChange: (l) => on(EVENTS.network, l),
  },
  offline: {
    topics: () => invoke('offline:topics'),
    randomProblem: (q) => invoke('offline:random-problem', q),
    problem: (id) => invoke('offline:problem', id),
    hints: (id, upto) => invoke('offline:hints', id, upto),
    solution: (id) => invoke('offline:solution', id),
    run: (id, code) => invoke('offline:run', id, code),
    submit: (id, code) => invoke('offline:submit', id, code),
  },
  onMenu: (l) => on(EVENTS.menu, l),
};

contextBridge.exposeInMainWorld('dsaDesktop', bridge);
