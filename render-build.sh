#!/usr/bin/env bash
set -euo pipefail

echo "[render-build] Enable corepack / pnpm"
corepack enable
corepack prepare pnpm@9.15.4 --activate

echo "[render-build] Install server dependencies"
pnpm --dir server install --no-frozen-lockfile

echo "[render-build] Install client dependencies"
pnpm --dir client install --no-frozen-lockfile

echo "[render-build] Build client"
pnpm --dir client run build
