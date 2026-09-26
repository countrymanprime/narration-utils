#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web (docs/operations/agent-train.md).
# Brings a fresh cloud container up to the pins in scripts/toolchain.json so an
# unattended worker can run the repo's checks without spending turns on setup.
# Local sessions skip it: the owner's machine is provisioned by `pnpm bootstrap`.
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$root"

pin() { node -e "const t=require('./scripts/toolchain.json');const v=t[process.argv[1]];console.log(typeof v==='string'?v:v.version)" "$1"; }
go_version="$(pin go)"
uv_version="$(pin uv)"

log() { echo "[session-start] $*" >&2; }

# Persist for every later Bash call in this session.
if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
  {
    echo "export GOTOOLCHAIN=go${go_version}"
    echo "export UV_PYTHON=3.12"
    echo "export PATH=\"$root/.venv/bin:\$HOME/go/bin:\$PATH\""
  } >>"$CLAUDE_ENV_FILE"
fi
export GOTOOLCHAIN="go${go_version}" UV_PYTHON=3.12

# uv: the lockfile needs the pinned version.
if ! uv --version 2>/dev/null | grep -q "^uv ${uv_version}"; then
  log "uv -> ${uv_version}"
  uv self update "${uv_version}" >/dev/null 2>&1 || pip install --quiet "uv==${uv_version}" || log "uv update failed; continuing with $(uv --version)"
fi

log "go $(go version | awk '{print $3}')"
uv python install 3.12 >/dev/null
log "uv sync (includes the lua group for the REAPER harness)"
uv sync --locked >/dev/null || log "uv sync failed"
log "pnpm install"
pnpm install --frozen-lockfile --reporter=silent || log "pnpm install failed"

# Go tools are slow to build; do them in the background so the session starts.
(
  go install "$(node -p "require('./scripts/toolchain.json')['golangci-lint'].module")@$(node -p "require('./scripts/toolchain.json')['golangci-lint'].version")" &&
    go install "$(node -p "require('./scripts/toolchain.json').checklocks.module")@$(node -p "require('./scripts/toolchain.json').checklocks.version")"
) >/dev/null 2>&1 &

log "ready"
