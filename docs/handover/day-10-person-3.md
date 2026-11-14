# Day 10 — Person 3: packaging, user manual, report and demo

## What was built

- **Web production build:** `npm run build -w web` → `web/dist`. Build-time env and the same-origin reverse proxy (nginx example incl. Socket.IO) in `docs/design/release.md` §1. Hash routes kept on purpose so one build serves both the web host and the desktop app.
- **Desktop installers (electron-builder):** `desktop/release/DSA-Practice-0.0.1-arm64.dmg` built here (98 MB). The Electron smoke test passes **against the packaged .app** (`DSA_PACKAGED_APP=…`), so the installer's app logs in, judges offline and syncs. Config fixes: pinned `electronVersion` (hoisted Electron), `asarUnpack` for core's sandbox script, `npmRebuild: false` (see Known issues), artifact names, NSIS with a choose-folder page. Windows NSIS and Linux AppImage are configured but need their own OS to build. Code-signing notes for macOS (Developer ID + notarization), Windows (OV/EV) and Linux: `docs/design/release.md` §2.
- **Android APK:** `expo prebuild` + Gradle `assembleRelease` → `mobile/android/app/build/outputs/apk/release/app-release.apk` (74 MB, 5.5 min). Verified: installed on the Android emulator, signed in against the API, Practice loaded topics and the daily challenge. New `mobile/plugins/with-cleartext.js`: allows an `http://` API only when `DSA_ALLOW_HTTP=1` at prebuild (demo against a laptop), production stays HTTPS-only. Exact steps, release keystore and the EAS alternative: `docs/design/release.md` §3.
- **`docs/user-manual.md`** (install per platform, practise, stats, offline and sync states, settings and keyboard, troubleshooting, screenshot list S1–S14).
- **`docs/report/part-3.md`** (client architecture, auth, stats model, caching, offline UX, testing, limitations).
- **`docs/report/demo-script.md`** (8-minute timed script: web, desktop offline, Android; plus the final checklist).

## How to run

```bash
npm run build -w web
npm run build -w desktop && (cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64)
DSA_PACKAGED_APP="$PWD/desktop/release/mac-arm64/DSA Practice.app/Contents/MacOS/DSA Practice" npm run test:e2e -w desktop
cd mobile && DSA_ALLOW_HTTP=1 npx expo prebuild --platform android --no-install \
  && cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleRelease
```

## Known issues

1. **electron-builder pruned the workspace:** its default "install production dependencies" step ran a production install that removed dev dependencies from the root `node_modules` (Playwright, vitest, TypeScript, 7zip-bin). Fixed with `npmRebuild: false`; `npm ci` restores a pruned checkout.
2. Installers are unsigned (Gatekeeper / SmartScreen prompts, documented).
3. Windows and Linux installers not built here (no Windows/Linux machine); the config is in place.
4. The APK is signed with the debug keystore and has `EXPO_PUBLIC_API_URL` baked in (default `http://10.0.2.2:3000`, the emulator's view of this computer).
5. The default Electron icon is used (no app icon designed).
6. Screenshots S1–S14 for the manual are listed, not yet taken.

## Design decisions (viva)

- **Same origin for web + API** instead of CORS: the `SameSite=Strict` refresh cookie keeps working and CSRF stays impossible; the cost is a reverse proxy.
- **One web build for browser and desktop** (hash routes, relative assets): fewer artifacts to test; the cost is `#` in URLs.
- **Test the artifact, not just the source:** the same Playwright Electron test runs on the packaged .app, which caught nothing new but would catch packaging mistakes (asar, missing resources).
- **HTTP only by explicit opt-in on Android:** demos against a laptop work, but a forgotten flag can't ship a cleartext production build.
- **Signing is a CI-secret concern:** documented, not committed; no certificates in the repo.
