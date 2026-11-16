#!/usr/bin/env bash
# Development start: checks Node, creates + seeds the database on first run, starts the server with auto-reload.
set -e
cd "$(dirname "$0")/.."
node scripts/check-node.mjs
[ -f .env ] || cp .env.example .env
exec npm run dev
