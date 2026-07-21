# Supabase Root CA

`supabase-root-2021-ca.pem` is Supabase's platform-wide Postgres root CA
("Supabase Root 2021 CA"), used to validate the Supavisor pooler and direct
connection certificates under `sslmode=verify-full`.

This is a **public certificate** (no private key): safe to commit, does not
grant access to anything, and is identical for every Supabase project on this
CA generation.

## Why this file exists

Supabase's pooler certificate chain is not rooted in a publicly trusted CA
(it's self-signed at the root), so the OS/distro trust store — on macOS *and*
Linux — does not validate it. `sslmode=verify-full` fails with a generic TLS
verification error unless the client is explicitly given this root CA via
`sslrootcert`.

Confirmed by hand (2026-07-21) against the hosted "development" project's
transaction pooler:

```sh
openssl s_client -connect aws-0-ca-central-1.pooler.supabase.com:6543 \
  -starttls postgres -showcerts
# chain: *.pooler.supabase.com -> Supabase Intermediate 2021 CA
#        -> Supabase Root 2021 CA (self-signed)
```

## Usage

Postgres connection strings (pgx, psql, Goose) accept `sslrootcert` as a
standard libpq parameter:

```
postgresql://user:pass@host:6543/postgres?sslmode=verify-full&sslrootcert=/app/certs/supabase-root-2021-ca.pem
```

The Dockerfile copies this file to the same path in the runtime image, and
production `DATABASE_URL` must include `sslrootcert` pointing there for
`sslmode=verify-full` to succeed instead of failing the TLS handshake.

## Regenerating / verifying

Supabase also publishes this per-project from the dashboard (Project Settings
→ Database → SSL Configuration → download `prod-ca-2021.crt`). It's the same
root either way; re-fetch and diff if Supabase ever rotates it:

```sh
openssl s_client -connect aws-0-<region>.pooler.supabase.com:6543 \
  -starttls postgres -showcerts 2>&1 \
  | awk '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/' \
  | csplit -z -f cert- - '/-----BEGIN CERTIFICATE-----/' '{*}'
# the last cert- file (self-signed, issuer == subject) is the root.
sha256sum cert-02 supabase-root-2021-ca.pem  # should match
```
