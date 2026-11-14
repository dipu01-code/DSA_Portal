# Release builds: web, desktop installers, Android APK (Person 3, Day 10)

Every command runs from the repository root unless it says `cd`. Node 20, `npm ci` first.

## 1. Web (production build)

```bash
npm run build -w web          # tsc + vite build → web/dist (static files, ~4 MB incl. Monaco, lazy-loaded)
npx vite preview --outDir web/dist --port 4173   # local check
```

**Environment (build time, `VITE_*` are baked into the bundle):**

| Variable        | Production value | Why                                                                                                                                                 |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`  | _(empty)_        | Same origin as the API. The refresh token is an `HttpOnly; SameSite=Strict` cookie on `/api/v1/auth`, so the page and `/api` must share one origin. |
| `VITE_REALTIME` | `1`              | Socket.IO on the same origin (`/socket.io`); `0` = polling only.                                                                                    |
| `VITE_MOCK`     | `0`              | `1` only for the demo build without a server.                                                                                                       |

**Hosting: one origin, a reverse proxy in front.** Serve `web/dist` as static files and forward `/api` and `/socket.io` to the API:

```nginx
server {
  listen 443 ssl;  server_name dsa.example.edu;           # TLS: the cookie gets `Secure` when NODE_ENV=production
  root /srv/dsa/web/dist;
  location / { try_files $uri /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; }
  location /socket.io/ { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1;
                         proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```

The app uses hash routes (`/#/problem/two-sum`), so any static host works with no rewrite rules, and the same `web/dist` is what the desktop app loads from `app://`. (Kept on purpose instead of switching to BrowserRouter: one build for both, no host configuration; the cost is `#` in URLs.)

## 2. Desktop installers (electron-builder)

```bash
npm run build -w desktop                       # core + web/dist + Electron main/preload/sandbox worker
cd desktop
npx electron-builder --mac dmg --arm64         # → release/DSA-Practice-0.0.1-arm64.dmg   (built and tested here)
npx electron-builder --mac dmg --x64           # Intel Macs
npx electron-builder --win nsis                # → release/DSA-Practice-Setup-0.0.1.exe   (build on Windows, or macOS/Linux with Wine)
npx electron-builder --linux AppImage          # → release/DSA-Practice-0.0.1-x86_64.AppImage (build on Linux)
```

Config: `desktop/package.json` → `build`. Notes:

- `electronVersion` is pinned (28.3.3): in the npm workspace Electron is hoisted to the root, where electron-builder can't find it by itself.
- `@dsa-portal/core` is unpacked from `app.asar` (`asarUnpack`): its sandbox spawns `sandbox-exec.js` from its own folder with the app's Electron binary as Node (CR-018), so it has to be a real file.
- `web/dist` is copied to `Resources/web` and served on `app://dsa` with the strict CSP.
- `npmRebuild: false`: the app has no native modules, and electron-builder's "installing production dependencies" step otherwise runs a production install that **prunes the whole workspace's dev dependencies** (Playwright, vitest, TypeScript, 7zip-bin). If you see `ENOENT … 7zip-bin/…/7za` or tests can't find `@playwright/test`, that happened: run `npm ci`.

### Code signing (not done for the course build)

| OS                                                                        | Unsigned build                                                                                                                                                                                                                  | To sign                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                                                                     | Gatekeeper: "cannot be opened because the developer cannot be verified" → right-click the app → **Open**, or `xattr -dr com.apple.quarantine "/Applications/DSA Practice.app"`. Built with `CSC_IDENTITY_AUTO_DISCOVERY=false`. | Apple Developer ID Application certificate in the keychain (or `CSC_LINK` + `CSC_KEY_PASSWORD`), `hardenedRuntime: true`, then **notarize** (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; electron-builder's `notarize` option). |
| Windows                                                                   | SmartScreen "Windows protected your PC" → **More info → Run anyway**.                                                                                                                                                           | An OV/EV code-signing certificate: `CSC_LINK=cert.pfx CSC_KEY_PASSWORD=…` (or `WIN_CSC_LINK`). EV certificates get SmartScreen reputation at once.                                                                                              |
| Linux                                                                     | AppImage runs after `chmod +x`.                                                                                                                                                                                                 | Optional GPG signature of the file.                                                                                                                                                                                                             |
| Certificates and passwords go into CI secrets, never into the repository. |

## 3. Android APK (expo prebuild + Gradle)

```bash
cd mobile
# 1) native project (android/ is generated and git-ignored). DSA_ALLOW_HTTP=1 only for a demo against an http:// API:
DSA_ALLOW_HTTP=1 npx expo prebuild --platform android --no-install
# 2) the API URL is baked into the JS bundle at build time:
#    emulator → default http://10.0.2.2:3000;  phone → your computer's LAN IP or the HTTPS API
export EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
# 3) release build with JDK 17 or 21 and the Android SDK (ANDROID_HOME or android/local.properties)
cd android && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleRelease
# → mobile/android/app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

- `plugins/with-cleartext.js` sets `usesCleartextTraffic` only when `DSA_ALLOW_HTTP=1`; production builds stay HTTPS-only (Android's default since API 28).
- The template signs the release with the **debug keystore**: fine for the demo and for sideloading, not for Play. For a real release: `keytool -genkeypair -v -keystore dsa-release.keystore -alias dsa -keyalg RSA -keysize 2048 -validity 10000`, put the passwords in `~/.gradle/gradle.properties` (`DSA_UPLOAD_STORE_PASSWORD`, …) and point `signingConfigs.release` at them; or let EAS manage the key.
- **Alternative (cloud):** `npx eas-cli build -p android --profile preview` with `eas.json` `{"build":{"preview":{"android":{"buildType":"apk"}}}}` — needs an Expo account; not used here.
- Install Watchman (`brew install watchman`): without it the first Metro bundle crawls the whole monorepo.
