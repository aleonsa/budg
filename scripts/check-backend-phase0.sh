#!/bin/sh

set -eu

base_sha=${1:-}
zero_sha=0000000000000000000000000000000000000000

if [ "$#" -gt 0 ] && { [ -z "$base_sha" ] || [ "$base_sha" = "$zero_sha" ]; }; then
  printf '%s\n' 'backend gate: comparison base is required in CI' >&2
  exit 1
fi

if [ -n "$base_sha" ]; then
  if ! git cat-file -e "$base_sha^{commit}" 2>/dev/null; then
    printf 'backend gate: base commit %s is unavailable\n' "$base_sha" >&2
    exit 1
  fi

  if ! git diff --quiet "$base_sha" HEAD -- backend; then
    printf '%s\n' 'backend gate: backend changes are forbidden until Phase 1 activates Go checks' >&2
    git diff --stat "$base_sha" HEAD -- backend >&2
    exit 1
  fi
fi

untracked_backend=$(git ls-files --others --exclude-standard -- backend)

if ! git diff --quiet -- backend || ! git diff --cached --quiet -- backend || [ -n "$untracked_backend" ]; then
  printf '%s\n' 'backend gate: local backend changes are forbidden until Phase 1' >&2
  if [ -n "$untracked_backend" ]; then
    printf '%s\n' "$untracked_backend" >&2
  fi
  exit 1
fi

printf '%s\n' 'backend gate: Phase 0 experiment unchanged'
