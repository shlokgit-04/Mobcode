# Pushing Mobcode to GitHub

Status: the repo is initialized locally on branch `main` with a pristine
pre-redesign snapshot on branch **`pre-production-redesign`** (baseline commit
`9ab1102`). No remote exists yet — **I will not invent a URL**; this doc tells
you what to provide.

## 1. Create the repository

1. https://github.com/new → repository name `Mobcode` (or anything you like).
2. **Private** is recommended (this is a personal build).
3. Do **not** auto-generate README/.gitignore — the local repo already has them.
4. Copy the HTTPS URL, e.g. `https://github.com/<your-username>/Mobcode.git`

## 2. Create a Personal Access Token (PAT)

1. GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained**.
2. Repository access: **Only select repositories** → your `Mobcode` repo.
3. Repository permissions: **Contents: Read and write**. Nothing else needs more.
4. Expiration: 90 days or longer.
5. Copy the token (`github_pat_…`). **Do not paste it in chat or store it in the repo shell history.**

## 3. Give the remote + token to the assistant

Provide exactly:

```
HTTPS remote : https://github.com/<you>/<repo>.git
PAT          : github_pat_...
```

The push will be done as a single `git push -u origin main` (and the snapshot
branch), without echoing the token into logs — it is used only for the one
push in a URL that stays out of the repo config.

## 4. (One-time) fix your git identity

Your configured email is missing the `@` (`vaneshlok042gmail.com`), which
produces an unusable author identity in the baseline commit. Before pushing:

```bash
git config --global user.name  "Your Name"
git config --global user.email "vaneshlok042@gmail.com"   # with @!
```

Commits already made keep the old identity — they remain in history unless
rewritten (not recommended for the baseline).

## 5. What gets pushed (and what doesn't)

Committed: tracker-worthy source only. `.gitignore` ensures these **never**
reach GitHub:

- `mobcode.server.json` (contains the engine password) — only
  `mobcode.server.json.example`, a secrets-free template
- `.env`, `*.log`, `node_modules/`, `www/`, `dist/`
- `android/keystore.properties`, `android/app/mobcode-upload.keystore`,
  `*.jks`, `*.keystore` (signing material)
- build outputs, local logs

If the push summary ever lists a file with a secret name: abort and fix before
continuing.

## 6. After the push

Render → **New → Web Service** → choose the pushed repo → Docker runtime →
follow [DEPLOYMENT.md §2](DEPLOYMENT.md#2-create-the-service).
