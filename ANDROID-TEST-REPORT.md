# Mobcode Android — Test report (v1.0.0, versionCode 1)

Environment where these tests ran: **Kali Linux host, no Android emulator / no
physical device / no KVM available.** Everything below is factually limited to
that; device-only tests are listed honestly at the end and were **not**
performed.

Toolchain used for the build: Temurin JDK 21.0.2.0, Gradle 8.14.3
(distribution sha256-verified `bd711022…c5f3531`), AGP 8.13.0, Capacitor
8.6.0, Android SDK build-tools 36.0.0 + platform android-36.

---

## 1. Tests executed — and results

### 1.1 Backend round-trip (real, not mocked)

| Check | Result |
|---|---|
| Companion server (`server.js` :8090, proxying private OpenCode :46000) alive | `GET /__mobcode/public → 200`; OpenCode answers `401` unauthenticated (auth enforced) |
| Full web app boot outside native mode (regression guard while adding the native layer) | booted, **16 pre-existing chats** listed, tab bar rendered, `0 page errors` |
| Real AI chat / streaming / model catalogue / providers / sessions on the live server | verified in earlier integration testing against the same running backend; the native-boot path (below) re-loads these same 16 sessions through the CORS path |

### 1.2 Native-mode boot simulations (headless Chromium, real backend + simulated Capacitor bridge)

The Capacitor JS bridge was **simulated** (stubbed `window.Capacitor` incl.
`MobcodeSecureStore`), everything else was real network traffic to the real
running backend:

| Check | Result |
|---|---|
| Encrypted-store connection profile loaded → app boots in native mode | `baseURL=http://127.0.0.1:8090`, `authMode=bearer`, chats rendered = **16**, tab bar present, no page errors |
| Connection profile persisted to secure store on connect | round-tripped through `MobcodeSecureStore.set/get` |
| **First launch, no stored connection** | welcome/connect screen is shown (no auto-connect, no localhost dependency) |
| **Production HTTP rejected by the app itself** | entering `http://insecure-prod.example.com` yields: *"Insecure HTTP is rejected. Use https:// for the Mobcode backend (http is permitted only for local development hosts)."* — no network request was made |

### 1.3 Server-side CORS for packaged-app origins (real backend)

| Check | Result |
|---|---|
| Preflight `OPTIONS` for origin `https://localhost` | `204`, `Access-Control-Allow-Origin: https://localhost`, correct Allow-Methods/Headers, `Access-Control-Max-Age: 86400` |
| Proxied `GET /api/model` for native origin | `200` with `Access-Control-Allow-Origin: https://localhost` (upstream engine CORS headers are stripped so the native origin wins) |
| Non-native web clients | unaffected (no `Origin` header → no CORS branch) |

### 1.4 Build artifact verification

Files (exact paths):

```
dist/android/debug/Mobcode-debug.apk       6,315,503 bytes  sha256 22868e62…
dist/android/release/Mobcode-release.apk   4,803,053 bytes  sha256 3b6f4f99…
dist/android/playstore/Mobcode-release.aab 4,583,178 bytes  sha256 0c1d3961…
```

| Check | Result |
|---|---|
| Release APK signature (`apksigner verify -v`) | **v2 scheme: true**, single signer, `CN=Mobcode, OU=Mobile, O=Mobcode, C=DE`, SHA-256 cert digest `d8b7b9d700fa3b327757d5c1cd308fa1319ebe1ba5dea9dedd24c605a68c411b` |
| Debug APK signature | signed with `CN=Android Debug` (real debug build — release was **not** renamed) |
| AAB signature (`keytool -printcert -jarfile`) | `Owner: CN=Mobcode…`, valid 2026-11-01 → **2054-03-19** |
| Badging (`aapt2 dump badging`, release) | `com.mobcode.app`, `versionCode=1`, `versionName=1.0.0`, `minSdkVersion:24`, `targetSdkVersion:36` (compile 36 / Android 16), label `Mobcode`, permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE` (auto-added by Capacitor haptics, normal) |
| Manifest security attrs (release) | `allowBackup=false`, `networkSecurityConfig` set, no `debuggable` |
| Secret scan inside all 3 artifacts (bundled JS/assets) | **0 hits** for `mobcode-local-v2`, `ghp_`, `github_pat_`, `sk-ant`, `OPENCODE_SERVER_PASSWORD` |
| Dist layout + naming | exactly `debug/Mobcode-debug.apk`, `release/Mobcode-release.apk`, `playstore/Mobcode-release.aab` |
| Bundled web assets are the current build | Packaged `mobcode-build.json` stamp matches the last sync (`builtAt 2026-11-01T11:36:16Z`) |

### 1.5 Branding assets

| Check | Result |
|---|---|
| Adaptive icon (all densities, 99 generated files) | Mobcode gradient mark on `#0B0E14` background; visually verified |
| Splash screens (portrait/landscape, all densities) | generated from brand asset; visually verified |
| Play assets | `dist/meta/icon-512.png` (512×512, 42,747 B), `dist/meta/feature-graphic.png` (1024×500, 196,904 B) |

---

## 2. Tests NOT performed (require an Android device/emulator — none available)

State plainly: **the following could not be executed in this environment**, and
therefore are unverified:

1. **APK installation on a real device** (`adb install` / sideload prompt /
   unknown-sources flow) and **first launch with the native splash, WebView
   boot, status bar and keep-screen behavior**.
2. **Connect-screen UX on device**: software keyboard behavior/resize, IME
   inset handling, autofill of the URL/password fields, real
   EncryptedSharedPreferences writes (Keystore-backed, device-bound) — the
   store was only exercised via the JS-level simulation.
3. **Hardware back button** behavior in the real WebView (sheet → nav stack →
   minimize path); only the JS handler logic exists and was wired but not
   device-tested.
4. **SSE streaming over real mobile networks**: Wi-Fi ↔ mobile-data switch,
   brief dropout reconnect, and behavior under Doze/battery-saver during a
   long-running prompt. The recovery listeners are implemented and unit-sim
   callable, but real-radio behavior (socket stall vs. clean close) is
   unverified.
5. **Backgrounding/foregrounding** the actual app process (data refresh on
   resume, SSE resume).
6. **Haptics, native clipboard, native share sheet** — only the JS paths were
   simulated; the native plugin round-trips were not exercised on a device.
7. **Internal-track install via Play** (and the full Play submission flow)
   — no Play Console account was used.
8. Release-build **startup** on a real device.

Recommended quick pass when a device is available (15 min): install
`Mobcode-debug.apk` → connect to the production backend → send one prompt →
airplane-mode toggle → back to online → background/foreground → verify no
duplicate prompt and no message loss → repeat 2× with `Mobcode-release.apk`.

---

## 3. Known (non-blocking) observations

* `apksigner` prints JDK-25-vs-native-access *warnings* when the system Java is
  used; building uses JDK 21 and the APKs verify clean. Cosmetic.
* Release APK verifies under the **v2 scheme only** (JAR/v1 signing is off) —
  correct and expected for minSdk 24 on modern AGP; Play accepts it.
* `VIBRATE` permission appears in badging — auto-added by Capacitor's haptics
  plugin; no user data implication.
* The service worker remains bundled for web-deployment parity but is inert
  inside the WebView (the native app talks directly to the configured backend).
* The debug variant additionally permits HTTP for `localhost / 127.0.0.1 /
  10.0.2.2` only (via `src/debug` network security config); the release variant
  enforces HTTPS system-wide. Verified the two configs are in the right source
  sets.

## 4. Verdict

All environment-permissible checks pass: builds reproducible, signatures
valid, branding real, secrets absent, production-HTTP rejection active,
native boot + server round-trips verified against the real backend. The app
should next be qualified on a physical device using the list in §2 before
being treated as release-final.
