#!/usr/bin/env bash
# One-time setup. Usage: bash scripts/setup.sh [--with-tests]
set -euo pipefail
cd "$(dirname "$0")/.."

need_major=20
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it first:"
  echo "  macOS:  brew install node"
  echo "  other:  https://nodejs.org (version $need_major or newer)"
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt "$need_major" ]; then
  echo "Node $(node -v) is too old; version $need_major or newer is required."
  exit 1
fi

echo "→ Installing dependencies"
npm install

if [ "${1:-}" = "--with-tests" ]; then
  echo "→ Installing the test browser (Chromium, for Playwright)"
  npx playwright install chromium
fi

echo "→ Checking that everything builds"
npm run build

cat <<'DONE'

Setup complete.
  npm start        dev server with live reload; opens your browser
  npm run check    type-check + unit tests + browser tests (run setup with --with-tests first)
  npm run build    production build into dist/  (serve with: npm run preview)
Add ?dev=1 to the URL for dev mode.
DONE
