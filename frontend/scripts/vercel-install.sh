#!/bin/sh
# Vercel only lets a project pin a *major* Node.js version (see
# docs/ci-cd.md); the exact patch on the 24.x line it currently provisions
# (observed 24.15.0) ships whatever npm happened to bundle with it (observed
# 11.12.1), not the exact npm this repo pins in package.json#engines/.npmrc.
#
# Force the same pinned npm CI uses (.github/workflows/ci.yml) before
# installing dependencies, so a Vercel build and a CI build resolve the exact
# same dependency tree instead of silently trusting whatever npm Vercel ships.
set -eu

NPM_VERSION=12.0.1
NPM_INTEGRITY='sha512-L5T9i/YAQWQWqTS/xZxJkei/9zcu99hCeE4qi41IyBVV7mRQad3qc2JfuOktwmH+qwGI/V2rbCL+/UYxb1+RQA=='

actual="$(npm view "npm@${NPM_VERSION}" dist.integrity)"
if [ "$actual" != "$NPM_INTEGRITY" ]; then
  echo "npm@${NPM_VERSION} integrity mismatch: expected $NPM_INTEGRITY, got $actual" >&2
  exit 1
fi

npm install --global "npm@${NPM_VERSION}" --ignore-scripts
npm ci
