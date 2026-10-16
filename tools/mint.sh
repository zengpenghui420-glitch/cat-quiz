#!/usr/bin/env bash
# Mint limited-use codes into MantleDB (each code: 3 uses).
# Usage: MANTLE_KEY=... ./tools/mint.sh [count]
# Or: put key in ../../store path / env file (not committed).
set -euo pipefail
NS="${MANTLE_NS:-catquiz-zph420-codes}"
KEY="${MANTLE_KEY:-}"
COUNT="${1:-10}"
MAX_USES="${MAX_USES:-3}"
if [[ -z "$KEY" && -f "${MANTLE_CREDS:-}" ]]; then
  KEY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['key'])" "$MANTLE_CREDS")
fi
if [[ -z "$KEY" ]]; then
  echo "Set MANTLE_KEY env (write key for namespace $NS)" >&2
  exit 1
fi
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'
minted=()
i=0
while [[ $i -lt $COUNT ]]; do
  code=''
  for _ in 1 2 3 4 5 6; do
    code+=${ALPHABET:RANDOM%${#ALPHABET}:1}
  done
  resp=$(curl -sS -X POST "https://mantledb.sh/v2/$NS/c/$code" \
    -H "Content-Type: application/json" \
    -H "X-Mantle-Key: $KEY" \
    -H "User-Agent: cat-quiz-mint/1.0" \
    -d "{\"remaining\":$MAX_USES,\"max\":$MAX_USES,\"created\":\"$(date -Iseconds)\"}")
  echo "$code  $resp"
  minted+=("$code")
  i=$((i+1))
done
echo "-----"
echo "Minted ${#minted[@]} codes (each $MAX_USES uses):"
printf '%s\n' "${minted[@]}"
