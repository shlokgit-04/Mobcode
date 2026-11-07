# Play Store listing — Mobcode

## Builder drafts (paste-ready)

### App short description (≤ 80 chars)

> Your code. Your agent. Anywhere. — the AI coding agent, on your server.

**Alternative:** `AI coding chat powered by your own OpenCode server. Mobile.packaged.`

### Full description (≤ 4000)

> **Mobcode — Your code. Your agent. Anywhere.**
>
> Mobcode is the mobile front-end for your OpenCode AI coding environment.
> It connects to **your own** backend (the Mobcode companion server), which
> talks to **your** OpenCode engine and your configured model providers on its
> machine. Privacy by architecture: there are no accounts in the app, no
> analytics, and no third-party SDKs — your backend URL and optional password
> are the only things stored, and they live encrypted on your device.
>
> Features
> • **AI chat** with streaming responses (SSE), interrupts, and agents
> • **Dynamic model catalogue** fetched live from your server — nothing hardcoded
> • **Model switching** mid-conversation, including model variants
> • **Provider management** — connect API-key/OAuth/env providers through your
>   server's own flows; keys never live in the app
> • **Sessions** — resume any previous coding chat
> • **Connection security** — HTTPS enforced; insecure production HTTP rejected
> • Adaptive icon, native splash, haptics, clipboard/share, back-button
>   navigation, network recovery
>
> Requirements
> • A running Mobcode/OpenCode backend that you control (see README-ANDROID.md
>   in the project repo for the single-service Render deployment).
> • Enter its URL on the welcome screen on first launch.
>
> This is Mobcode v1.0.0 — package com.mobcode.app.

### Category

* **Primary:** Tools
* **Secondary:** Productivity

### Tags (5)

`android, ai, coding, agent, self-hosted`

### Developer identity + contact

* Website: (your repo/backend landing page)
* Email: (your support address)
* **Do not invent an address/corporation that doesn't exist.**

---

## Asset specs

| Asset | Spec | Notes |
|---|---|---|
| App icon | 512×512 PNG32 ≤ 1MB | generated: `dist/meta/icon-512.png` (from `assets/icon.png`) |
| Feature graphic | 1024×500 JPG/PNG no transparency | generated: `dist/meta/feature-graphic.png` with logo + tagline |
| Phone screenshots | ≥2, aspect within [9:16 .. 16:9], long ≤ 3840px | must be captured on device/emulator (see ANDROID-TEST-REPORT) |

Screenshot shot-list (the 4 to prioritise on device):

1. Chats list (home) with real session titles from your backend.
2. Chat thread showing a streamed answer + copy/share affordances.
3. Model picker sheet — dynamic catalogue + provider chips.
4. Providers screen — connected provider cards.

---

## Content rating questionnaire (guide — answer honestly in the console)

* Violence/terrorism/sex/nudity/sexually suggestive: none.
* Controlled substances / gambling / weapons: none.
* Chat/UGC between users: the app's chat is **user ↔ AI assistant on the user's
  own backend**; it is not a social network and has no third-party user
  interaction surfaces. Answer "no user-generated content shared with other users".
* Data collection forms are covered in DATA-SAFETY-CHECKLIST.md.
* Target age appears as **Everyone (PEGI 3)** under these answers.

## Restricted answers

* No ads, no live streaming, no third-party IP dispute risk (icons/fonts are
  original code + generated art).

## Consent + reviewer access

* Reviewer ("App access") gets the backend URL + optional password (see
  PLAY-STORE-RELEASE.md §2) and the one-line script: "Enter URL on welcome
  screen → continue. Manage chats/providers/settings from the main tabs."
