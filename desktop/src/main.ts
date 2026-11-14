import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { nativeRefresh, REFRESH_TOKEN_KEY } from '@dsa-portal/ui-core/auth/refresh';
import { CONFIG_SYNC, EVENTS, INVOKE, type InvokeChannel } from './ipc-channels';
import { watchNetwork } from './network';
import { createOfflineEngine } from './offline-engine';
import { safeStorageStore } from './token-store';

const API = (process.env.DSA_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const POLL_MS = Number(process.env.DSA_NETWORK_POLL_MS) || 5000;
if (process.env.DSA_USER_DATA) app.setPath('userData', process.env.DSA_USER_DATA);

const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '../../web/dist');
const ORIGIN = 'app://dsa';
// Monaco injects inline styles; scripts and workers only from the app itself; network only to the API.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${API} ${API.replace(/^http/, 'ws')}`, // REST + Socket.IO
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const tokens = safeStorageStore();
const offline = createOfflineEngine();
let network: ReturnType<typeof watchNetwork>; // started once the app is ready (net needs it)

/** Serves web/dist on app://dsa with the CSP header; refuses anything outside that folder. */
function serveApp() {
  protocol.handle('app', async (req) => {
    const { host, pathname } = new URL(req.url);
    const file = path.normalize(
      path.join(WEB_DIST, decodeURIComponent(pathname === '/' ? '/index.html' : pathname))
    );
    if (host !== 'dsa' || !file.startsWith(WEB_DIST + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'content-security-policy': CSP,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- IPC (allow-list + argument checks)
const str = (v: unknown, max: number, name: string) => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`invalid ${name}`);
  return v;
};
const int = (v: unknown, name: string) => {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100) {
    throw new Error(`invalid ${name}`);
  }
  return v as number;
};
const CODE_MAX = 64 * 1024; // same order as the server's body limit for submissions

const handlers: Record<InvokeChannel, (...args: unknown[]) => unknown> = {
  'auth:save-refresh-token': (t) => tokens.set(REFRESH_TOKEN_KEY, str(t, 512, 'token')),
  'auth:refresh': () => nativeRefresh(API, tokens)().catch(() => null),
  async 'auth:logout'() {
    const t = await tokens.get(REFRESH_TOKEN_KEY);
    await tokens.remove(REFRESH_TOKEN_KEY);
    if (t) {
      await fetch(`${API}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { cookie: `refresh_token=${t}` },
      }).catch(() => {});
    }
  },
  'network:is-online': async () => {
    await network.ready;
    return network.isOnline();
  },
  'offline:topics': () => offline.topics(),
  'offline:random-problem': (q) => {
    const { topic, difficulty } = (q ?? {}) as { topic?: unknown; difficulty?: unknown };
    if (difficulty !== undefined && !['Easy', 'Medium', 'Hard'].includes(difficulty as string)) {
      throw new Error('invalid difficulty');
    }
    return offline.randomProblem({
      topic: topic === undefined ? undefined : str(topic, 64, 'topic'),
      difficulty: difficulty as 'Easy' | undefined,
    });
  },
  'offline:problem': (id) => offline.problem(str(id, 128, 'id')),
  'offline:hints': (id, upto) => offline.hints(str(id, 128, 'id'), int(upto, 'upto')),
  'offline:solution': (id) => offline.solution(str(id, 128, 'id')),
  'offline:run': (id, code) => offline.run(str(id, 128, 'id'), str(code, CODE_MAX, 'code')),
  'offline:submit': (id, code) => offline.submit(str(id, 128, 'id'), str(code, CODE_MAX, 'code')),
};

/** Only our own page (app://dsa) may call main; e.g. a navigated-away or injected frame can't. */
const fromApp = (e: { senderFrame: { url: string } | null }) =>
  e.senderFrame?.url.startsWith(`${ORIGIN}/`) === true;

function registerIpc() {
  for (const channel of INVOKE) {
    ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!fromApp(e)) throw new Error('IPC refused: unknown sender');
      return handlers[channel](...args);
    });
  }
  ipcMain.on(CONFIG_SYNC, (e) => {
    e.returnValue = fromApp(e) ? { apiBaseUrl: API } : null;
  });
}

// ---------------------------------------------------------------- window + menu
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'DSA Practice',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // The app never navigates away from itself or opens windows; external links go to the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

function buildMenu() {
  const send = (action: 'run' | 'submit' | 'switch-topic') => () =>
    BrowserWindow.getFocusedWindow()?.webContents.send(EVENTS.menu, action);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'Practice',
        submenu: [
          { label: 'Run tests', accelerator: 'CmdOrCtrl+Enter', click: send('run') },
          { label: 'Submit', accelerator: 'CmdOrCtrl+Shift+Enter', click: send('submit') },
          { type: 'separator' },
          { label: 'Switch topic…', accelerator: 'CmdOrCtrl+K', click: send('switch-topic') },
        ],
      },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ])
  );
}

app.whenReady().then(() => {
  // No camera, microphone, notifications etc. for web content.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  network = watchNetwork(API, POLL_MS, (online) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(EVENTS.network, online);
  });
  serveApp();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  network?.stop();
  offline.dispose();
});
