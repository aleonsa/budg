#!/bin/sh

set -eu

: "${BUDG_API_PASSWORD:?BUDG_API_PASSWORD is required}"

container=${SUPABASE_DB_CONTAINER:-supabase_db_budg}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

docker exec -i "$container" psql \
  --username postgres \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --set "budg_api_password=$BUDG_API_PASSWORD" \
  < "$script_dir/bootstrap-runtime-role.sql"
