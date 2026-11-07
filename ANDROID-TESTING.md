# Android build & testing guide (v1.1.0)

> **ADB stays disconnected until every build + deploy step is verified.**
> When told to reconnect, come back to §4.

## 1. Pipeline (scripts/package-android.sh)

```bash
bash scripts/package-android.sh
```

What it does, in order:

1. `node scripts/prepare-android.mjs` — copies `public/` → `www/` unchanged
   (except the stamp note) — **no source rewrite**.
2. `npx cap sync android` — pushes `www/` into the native shell.
3. **Packaging gate** (`scripts/verify-android-config.mjs`):
   - release build **fails** unless `public/app/js/config.js` has the verified
     Render URL stamped (`node scripts/set-production-url.mjs https://…`)
     and the dev override is `false`;
   - `ANDROID_ALLOW_DEV_CONFIG=1` forces a dev build labeled as such.
4. `./gradlew assembleDebug assembleRelease bundleRelease`.
5. Signature + badging verification with `apksigner`/`aapt2`/`keytool`.
6. Deliverables:
   - `dist/android/debug/Mobcode-debug.apk`
   - `dist/android/release/Mobcode-release.apk`
   - `dist/android/playstore/Mobcode-release.aab`

Keystore material is **never** in git: `android/keystore.properties` +
`mobcode-upload.keystore` stay on-disk outside the repo (see `SECURITY.md`).

## 2. Version

```
applicationId com.mobcode.app
versionCode   2
versionName   1.1.0
```

Bumps must keep the Play `versionCode` strictly increasing.

## 3. Local debug build (no device needed)

```bash
cd android && ./gradlew assembleDebug
ls -la app/build/outputs/apk/debug/app-debug.apk
```

## 4. Install to your phone (final step — after everything else is verified)

```bash
# reconnect the phone via USB, enable USB debugging, then:
adb devices                       # confirm the device id shows up
adb install -r dist/android/debug/Mobcode-debug.apk     # daily build
adb install -r dist/android/release/Mobcode-release.apk # signed release test

# first launch checklist inside the app:
#   - Connect screen: enter https://<your-service>.onrender.com
#   - status pill goes "online"
#   - Home → model list loads from the real server
#   - open a chat, send a message, watch SSE drift in
```

`adb logcat -s Capacitor:* | head` when something looks broken.

## 5. Regression checklist (before any release promote)

| # | Test | Expect |
|---|------|--------|
| 1 | Cold-launch app | Connect screen (first run) or Home |
| 2 | Home tab | real model/participants lists from the engine |
| 3 | Projects tab | real `/api/project` result for the backend directory |
| 4 | Activity tab | real event feed accumulating as you use chats |
| 5 | New chat → pick model | session created on `/api/session`; title appears |
| 6 | Send a prompt | streamed (SSE), tool activity cards, real token/cost meta |
| 7 | Model switch inside a session | model chip updates; next reply from new model |
| 8 | Workspace panel | real file list + VCS status in the backend workspace |
| 9 | Integrations sheet | real provider list; disconnect removes its models |
| 10 | MCP sheet | real `/api/mcp` content (may be empty by design) |
| 11 | Theme light/dark | both themes readable; persists across launch |
| 12 | Offline mode (toggle air) | connection pill drops; app does not crash; reconnect on return |
| 13 | Keep-alive endpoint from phone browser | 200 json — makes a fast sanity check of deployed prod |
| 14 | Attach file to a prompt | file uploaded to backend FS (`/api/experimental/fs/write`); referenced uri in prompt |

The scripted server-side regression suite (models, prompts, SSE, sessions,
providers, MCP, fs, restart) is run from the machine, not the phone —
see `scripts/` and `RELEASE-NOTES.md` for the last recorded run.
