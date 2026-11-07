# Play Data Safety checklist — Mobcode v1.0

Fill the Console App content → **Data safety** form exactly as below. Every
entry is derived from `PRIVACY-POLICY.md` (which was written from an audit of
the actual code paths — `api.js`, `views.js`, `main.js`, `native.js`,
`android/…/AndroidManifest.xml`) — **no unverifiable claims either way**.

---

## Q: Does your app collect or share any of the required user data types?

**Answer: No** — with these precise nuances:

* The app **transmits user-typed chat text off the device**, but the recipient
  is the user's *own* backend, operated by the same person for the same person
  (single-user deployment). Play's form asks about **collection or sharing**;
  where the data only travels between one user and their own service for
  functionality, it is not "collected" in the Play sense and is not "shared"
  with third parties. However, the **conservative** reading many reviewers
  prefer is to declare user-entered text as "collected, not shared". Both
  readings are documented below — pick one and stay consistent with the
  published privacy policy.

### Option A (recommended, conservative)

| Play field | Choice |
|---|---|
| Data collection? | Yes |
| Data shared with third parties? | No |
| **Data type:** Text — including messages | Collected: **Yes** (transmitted to your backend for app functionality) · Ephemeral: **No** (session logs live on your backend per your own retention policy) · Purpose: **App functionality** |
| Analytics/app events | None |
| Device identifiers | None |

### Option B (minimal)

| Play field | Choice |
|---|---|
| Data collection? | No |
| Data shared? | No |
| Notes for review | "The app connects only to the user's own self-hosted backend; no data is collected by the developer." |

If you choose B, the privacy policy must still document the transmission
(honesty requirement), and reviewer access notes must include backend access.

## Security questionnaire

* Data encrypted in transit: **Yes** (HTTPS enforced; cleartext rejected at the
  network-security-config level).
* Deletion mechanism: users clear app data (on-device caches + encrypted prefs)
  and can delete chat sessions from the app (Chats → chat → server removes the
  session); backend-side retention is the operator's responsibility.

## App access

* In "App access → Credentials", add your backend URL (and optional backend
  password if configured) so the reviewer can pass the welcome screen.

## Not-allowed claims

* Do NOT check "No data collected" AND also omit server commentary — pick the
  consistent story above.
* Do NOT claim GDPR/HIPAA/etc. certifications that the code cannot guarantee.
