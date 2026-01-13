#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="9000"
API_URL="http://127.0.0.1:${PORT}"
OUT_PDF="${ROOT_DIR}/poc-test.pdf"
MARKDOWN_FILE="${ROOT_DIR}/test-doc.md"
cd "${ROOT_DIR}"

if [[ ! -d node_modules ]]; then
  echo "[POC] Installing dependencies..."
  npm install --no-progress --prefer-offline
fi

SERVER_PID=""
cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

PORT="${PORT}" node "${ROOT_DIR}/index.js" >/tmp/poc-pdf.log 2>&1 &
SERVER_PID=$!

for i in {1..30}; do
  if curl -sf "${API_URL}/health" >/dev/null; then
    echo "[POC] Server is up on ${API_URL}"
    break
  fi
  sleep 0.3
done

if ! curl -sf "${API_URL}/health" >/dev/null; then
  echo "[POC] Server did not become ready; check /tmp/poc-pdf.log" >&2
  exit 1
fi

HTML_CONTENT="$(npx marked -i "${MARKDOWN_FILE}")"

PAYLOAD="$(HTML_CONTENT="${HTML_CONTENT}" node --input-type=module - <<'NODE'
import { loadDefaultPrintStyles, printStylesToCss } from './style-utils.js';

const html = process.env.HTML_CONTENT || '';
const printStyles = loadDefaultPrintStyles();
const cssStyles = printStylesToCss(printStyles);

const payload = { htmlContent: html, cssStyles, printStyles };
console.log(JSON.stringify(payload));
NODE
)"

curl -X POST "${API_URL}/render-pdf" \
  -H "Content-Type: application/json" \
  --data "${PAYLOAD}" \
  -o "${OUT_PDF}"

echo "[POC] Wrote ${OUT_PDF}"
