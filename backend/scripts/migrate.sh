#!/bin/sh

set -eu

usage() {
  echo "Usage: $0 <dev|prod> <status|up> [--confirm-production]" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage

environment=$1
action=$2
confirmation=${3:-}

case "$environment" in
  dev) expected_environment=development ;;
  prod) expected_environment=production ;;
  *) usage ;;
esac

case "$action" in
  status | up) ;;
  *) usage ;;
esac

if [ "$environment" = "prod" ] && [ "$action" = "up" ] && [ "$confirmation" != "--confirm-production" ]; then
  echo "Refusing production migration without --confirm-production" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
env_file=${BUDG_MIGRATION_ENV_FILE:-"$repo_root/local/env/migrations.$environment.env"}

if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

: "${MIGRATIONS_DATABASE_URL:?Set MIGRATIONS_DATABASE_URL in $env_file or the shell environment}"

if [ "${BUDG_MIGRATION_ENV:-}" != "$expected_environment" ]; then
  echo "Refusing migration: BUDG_MIGRATION_ENV must equal $expected_environment" >&2
  exit 2
fi

case "$MIGRATIONS_DATABASE_URL" in
  *prefer_simple_protocol=*) goose_dbstring=$MIGRATIONS_DATABASE_URL ;;
  *\?*) goose_dbstring="${MIGRATIONS_DATABASE_URL}&prefer_simple_protocol=true" ;;
  *) goose_dbstring="${MIGRATIONS_DATABASE_URL}?prefer_simple_protocol=true" ;;
esac

export GOOSE_DRIVER=postgres
export GOOSE_DBSTRING="$goose_dbstring"

echo "Running Goose '$action' against $expected_environment"
(cd "$repo_root/backend" && goose -env=none "$action")
