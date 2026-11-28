#!/bin/bash
# The SessionStart hook of Claude Code cloud sessions. .claude/settings.json runs it on startup and on resume.
# Outside a cloud session it stops at once, so a local session does not change.
# In a cloud session, localhost is the cloud VM. The script prepares the local stack of the CI smoke job in the VM:
#   1. Now: the Node of .nvmrc on PATH, and the npm packages.
#   2. In the background: local Supabase in Docker, .env and .dev.vars with the test settings, and the engine packages.
# Claude reads the plain output of step 1. Step 2 writes its state to /tmp/cloud-stack.state and its log to
# /tmp/cloud-stack.log.
# To test it on your machine, run it in a fresh clone: CLAUDE_CODE_REMOTE=true bash scripts/cloud-session.sh

STATE=/tmp/cloud-stack.state
LOG=/tmp/cloud-stack.log
EXCLUDE=studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor

# Step 2. Step 1 starts it in the background.
if [ "$1" = "--stack" ]; then
  cd "$(dirname "$0")/.." || exit 1
  fail() {
    echo "failed: $1" > "$STATE"
    exit 1
  }
  echo "running" > "$STATE"
  if ! docker info > /dev/null 2>&1; then
    nohup dockerd > /tmp/dockerd.log 2>&1 &
    for _ in $(seq 1 30); do
      docker info > /dev/null 2>&1 && break
      sleep 1
    done
  fi
  docker info > /dev/null 2>&1 || fail "Docker does not start. See /tmp/dockerd.log"
  # The same services as the smoke job. The script writes .env and .dev.vars only when they do not exist.
  node scripts/local.mjs --setup-only --exclude="$EXCLUDE" || fail "local Supabase"
  # The test settings of the smoke job. Astro reads them at build time, so they must be in .dev.vars before a build.
  for line in "SEND_EMAIL_HOOK_SECRET=$SMOKE_HOOK_SECRET" ALLOW_LOOK_OVERRIDE=true OAUTH_PROVIDERS=github,google \
    ENABLE_JOB_CHECK=true ALLOW_PRIVATE_COURSE_URLS=true WORKER_WAKE_URL=http://localhost:8788/wake \
    WORKER_WAKE_SECRET=local-wake-secret; do
    grep -q "^${line%%=*}=" .dev.vars || echo "$line" >> .dev.vars
  done
  uv sync --directory engine --frozen || fail "uv sync of the engine. Local Supabase runs"
  echo "ok" > "$STATE"
  exit 0
fi

# Step 1.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0
keep() { [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "$1" >> "$CLAUDE_ENV_FILE"; }

# scripts/cloud-setup.sh, the setup script of the cloud environment, installs these two folders.
if [ -x /opt/node26/bin/node ]; then
  export PATH="/opt/node26/bin:$PATH"
  keep 'export PATH="/opt/node26/bin:$PATH"'
fi
if [ -d /opt/ms-playwright ]; then
  keep 'export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright'
fi
want="v$(cat .nvmrc)"
if [ "$(node --version 2> /dev/null)" != "$want" ]; then
  echo "Cloud session: Node $want is missing. Add scripts/cloud-setup.sh as the setup script of the cloud environment."
  exit 0
fi

# npm ci runs only when package-lock.json changed after the last install.
stamp=node_modules/.cloud-session.sha256
if ! sha256sum --check --status "$stamp" 2> /dev/null; then
  rm -f "$stamp"
  if ! npm ci > /tmp/npm-ci.log 2>&1; then
    echo "Cloud session: npm ci failed. See /tmp/npm-ci.log."
    exit 0
  fi
  sha256sum package-lock.json > "$stamp"
fi

# The smoke test signs its Send Email Hook calls with the secret in .dev.vars. A new VM gets a new random secret.
secret=$(grep -s '^SEND_EMAIL_HOOK_SECRET=' .dev.vars | cut -d= -f2-)
[ -n "$secret" ] || secret="v1,whsec_$(openssl rand -base64 32)"
keep "export SMOKE_HOOK_SECRET='$secret'"

detach=""
command -v setsid > /dev/null && detach=setsid
SMOKE_HOOK_SECRET="$secret" $detach nohup bash "$0" --stack < /dev/null > "$LOG" 2>&1 &

cat << 'EOF'
Cloud session: localhost is this VM. Local Supabase starts in the background, as in the CI smoke job.
Before a step that needs the database, wait for it:
  until grep -qE '^(ok|failed)' /tmp/cloud-stack.state; do sleep 5; done; cat /tmp/cloud-stack.state
The log is /tmp/cloud-stack.log.
The Claude Code bridge does not work here. Start the topic engine with: npm run engine -- --fake
For the full smoke run, start the services in the order of the smoke job in .github/workflows/ci.yml.
EOF
exit 0
