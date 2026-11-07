# Mobcode Privacy Policy (draft — v1.1)

_Last updated: 2026-11-08. This draft says **only** what Mobcode verifiably does.
Nothing in this document is a marketing claim._

## What Mobcode is

Mobcode ("the app") is a mobile client for **your own** OpenCode installation.
The app itself contains no user accounts, no analytics, no ads, and no
third-party tracking SDKs. It connects to a backend that **you** operate (the
"Mobcode backend" — e.g. your Render deployment of the Mobcode companion
server), which then talks to an OpenCode engine and from there to the AI
providers you configured on **that** server.

## Data the app processes

| Data | Where it lives | Why |
|---|---|---|
| Chats you type (prompts + model replies) | In transit (HTTPS) between app → your backend → your OpenCode engine → your configured AI provider; cached in the app's memory/storage while a session is open; stored in *your backend's* OpenCode session store | Functionality of the AI chat you initiated |
| Backend server URL + optional backend password | On-device **only**, encrypted (Android Keystore-backed EncryptedSharedPreferences); backups disabled | So you can reconnect without re-entering it |
| Workspace directory preference | On-device (edge: WebView local storage, non-sensitive) | Scoping models/sessions |
| Recently used model names | On-device WebView local storage | The "Recently used" picker section |
| Session list metadata (titles, timestamps, model ids) | Fetched from *your backend* each launch; cached in memory; also mirrored in the backend's own database by design | Session management |

## What the app does NOT do

* Does **not** collect analytics, telemetry, or crash logs anywhere.
* Does **not** embed AI provider keys, GitHub tokens or any production secrets (verified: no credentials exist in `www/` or `android/app/src/main/assets`).
* Does **not** send data to the app author, ads networks, or any third-party SDK.
* Does **not** access contacts, photos, microphone, camera, precise location, or files on the device (manifest: `INTERNET`, `ACCESS_NETWORK_STATE` only).

## Credentials

Provider API keys / OAuth tokens are entered through **your OpenCode server's
own flows** and stored **on the backend machine** (OpenCode's own credential
store). The app never receives, displays, or stores them.

## V1.1 additions (multi-backend era)

The app now distinguishes three backend modes; the data story is the same in
each, but the "where" changes:

| Mode | Where the backend runs | Credential handling |
|---|---|---|
| PWA + companion proxy (browser) | your machine / your Render free-tier service | proxy injects engine Basic auth; clients send no password |
| Android release build (production URL stamped) | the deployment named **in the app config** | encrypted native store holds only the backend URL (+ optional password) |
| Dev/advanced native build | any URL you enter (Connect screen) | encrypted native store |

* File attachments (v1.1) are uploaded by the app to the workspace of the
  backend via `POST /api/experimental/fs/write`; the file bytes go app → your
  backend → workspace path → engine prompt. No third-party receives them.
* Health endpoints (`/health`, `/health/keepalive`) are public on the backend
  by design and expose **no user data** — only `ok`, version, uptime and
  process metadata.
* `ENGINE_PASSWORD` and provider keys never leave the backend machine: the
  companion holds and injects them; the app binary contains none (verified
  by the packaged-asset scan; see `scripts/verify-android-config.mjs`).

## Your backend's own handling

Because Mobcode is a "bring-your-own-backend" client, the privacy of server-side
session storage depends on where you host the backend. As a single-user/private
deployment, all backend-side data is yours. If you later run a multi-user
backend, you must extend this policy with the backend's retention rules.

## Children

Mobcode is not directed at children and requires your own deployed backend; it
does not target under-13 audiences.

## Contact

Contact the app maintainer through the address/org you publish with the listing.
