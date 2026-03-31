---
name: prod-server-debug
description: "Use when debugging the live production server, SSHing into the VPS, checking Docker Compose services, inspecting logs, comparing deployed config against the repo, navigating panino.sh paths, or triaging deployment drift on the production host. Helpful for signup/auth failures, env mismatches, nginx/static asset issues, and fast server navigation."
---

# Production Server Debugging

Use this skill for Panino production investigations on the VPS behind `panino.sh`.

## Scope

- Quickly navigate the production checkout and deployed asset locations.
- Inspect live config, Docker Compose state, container logs, nginx output, and git drift.
- Diagnose deployment mismatches between the repo and the server.
- Triage live auth, signup, sync, upload, and static asset issues.

## Safety Rules

- Default to read-only inspection unless the user explicitly asks for a server-side change.
- Never commit directly on the server.
- Never print plaintext secrets, tokens, or full env values. Mask them or show only the last 4-6 characters.
- Before overwriting a server file, create a timestamped backup first.
- Prefer non-interactive commands and concise output.
- If the server checkout is dirty, note exactly which files differ before attempting a pull or redeploy.

## Known Panino Production Paths

- App checkout: `/home/kris/www/panino`
- Frontend build source: `/home/kris/www/panino/frontend/dist`
- Served frontend root: `/var/www/panino.sh/dist`
- Common backend service: `api-service`
- Common backend container: `panino-api-service-1`

## Fast Navigation

Start from the repo checkout whenever possible:

```bash
cd /home/kris/www/panino
pwd
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Quick structure checks:

```bash
cd /home/kris/www/panino
ls
ls frontend
ls backend/api-service
docker compose ps
```

## High-Value Commands

### 1. Check deployment drift

```bash
cd /home/kris/www/panino
git status --short
git rev-parse HEAD
git remote get-url origin
git diff -- deploy.sh frontend/.env.production frontend/.env.production.local
```

Compare current server files to the checked-out commit:

```bash
cd /home/kris/www/panino
git show HEAD:deploy.sh | sed -n '160,180p'
sed -n '160,180p' deploy.sh
```

### 2. Inspect live env safely

Mask sensitive values instead of printing them raw:

```bash
cd /home/kris/www/panino
awk -F= '/^(TURNSTILE_SECRET_KEY|VITE_TURNSTILE_SITE_KEY|JWT_SECRET)=/ {
  value=$2
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
  gsub(/^"|"$/, "", value)
  suffix=(length(value) > 6 ? substr(value, length(value)-5) : value)
  print $1 "=***" suffix
}' .env
```

Check generated frontend env files:

```bash
cd /home/kris/www/panino/frontend
grep -nE 'VITE_API_SERVICE_URL|VITE_TURNSTILE_SITE_KEY|VITE_APP_VERSION' \
  .env.production .env.production.local 2>/dev/null
```

### 3. Inspect Docker and backend logs

```bash
cd /home/kris/www/panino
docker compose ps
docker compose logs --tail=100 api-service
docker logs --tail=100 panino-api-service-1
```

Filter for likely production failures:

```bash
cd /home/kris/www/panino
docker compose logs --tail=200 api-service | grep -iE 'error|signup|captcha|turnstile|jwt|sync|upload'
```

### 4. Check served frontend assets

```bash
grep -RIl 'challenges.cloudflare.com/turnstile' /var/www/panino.sh/dist
grep -RIl 'VITE_API_SERVICE_URL\|panino.sh/api' /var/www/panino.sh/dist
```

If you need to compare built output vs served output:

```bash
grep -RIl 'turnstile' /home/kris/www/panino/frontend/dist
grep -RIl 'turnstile' /var/www/panino.sh/dist
```

### 5. Verify running container env

Mask values when inspecting the live backend container:

```bash
docker inspect panino-api-service-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | awk -F= '/^(TURNSTILE_SECRET_KEY|JWT_SECRET)=/ {
      value=$2
      suffix=(length(value) > 6 ? substr(value, length(value)-5) : value)
      print $1 "=***" suffix
    }'
```

## Common Production Workflows

### Signup or auth failure

1. Check whether the frontend is rendering the expected widget or auth UI.
2. Compare root `.env` against generated frontend env files.
3. Check the backend container env for the corresponding secret.
4. Inspect logs for `signup`, `captcha`, `turnstile`, `jwt`, or `invalid signature`.
5. Confirm the served assets actually contain the expected frontend config.

### Deploy failed during `git pull`

1. Run `git status --short` in `/home/kris/www/panino`.
2. Identify which local files would block the pull.
3. Back them up before overwriting, if the user approves.
4. Avoid mutating tracked build-time env files on the server when a `.local` override can be used instead.

### Static asset or nginx mismatch

1. Confirm what `deploy.sh` writes into the frontend env.
2. Confirm what ended up in `/var/www/panino.sh/dist`.
3. Compare `/home/kris/www/panino/frontend/dist` to `/var/www/panino.sh/dist`.
4. Check nginx config/root paths if the served output does not match the latest build.

## Panino-Specific Gotcha

Do not rely on mutating the tracked `frontend/.env.production` file on the server. Prefer generating `frontend/.env.production.local` during deployment so production-only values like `VITE_TURNSTILE_SITE_KEY` are injected without creating checkout drift that breaks later `git pull` operations.

## Expected Output Style

- Lead with the root cause or the key discrepancy.
- Include the exact server path or container name involved.
- Summarize masked env alignment or mismatch explicitly.
- If a fix is needed, state the safest minimal change and whether it requires user approval.