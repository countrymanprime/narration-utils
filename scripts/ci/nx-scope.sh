#!/usr/bin/env bash
# Prints `all` or `affected`: how CI should scope its Nx run. Used by .github/actions/nx-run and
# .github/actions/nx-affected.
#
# Everything runs when the event is not a pull request, when the caller asks for it (ALWAYS=true),
# or when the change touches a file that every project depends on but no project owns. Otherwise
# only the projects the change affects run.
#
# Environment: ALWAYS, GITHUB_EVENT_NAME, BASE_REF (the pull request's base branch).
set -euo pipefail

workspace_wide='^(nx\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|pyproject\.toml|uv\.lock|project\.json|stylua\.toml|\.prettierrc\.json|\.prettierignore|\.editorconfig|\.gitattributes|scripts/(quality\.mjs|toolchain\.json|ci/nx-scope\.sh)|\.github/(workflows|actions)/)'

if [ "${ALWAYS:-false}" = "true" ] || [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]; then
  echo all
  exit 0
fi

# Captured first: `git diff | grep -q` can take a SIGPIPE under pipefail and print the wrong answer.
changed=$(git diff --name-only "origin/${BASE_REF}...HEAD")
if grep -Eq "$workspace_wide" <<<"$changed"; then
  echo all
else
  echo affected
fi
