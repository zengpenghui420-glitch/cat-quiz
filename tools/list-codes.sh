#!/usr/bin/env bash
set -euo pipefail
NS="${MANTLE_NS:-catquiz-zph420-codes}"
KEY="${MANTLE_KEY:?set MANTLE_KEY}"
curl -sS "https://mantledb.sh/v2/list/$NS" -H "X-Mantle-Key: $KEY" -H "User-Agent: cat-quiz-mint/1.0" | python3 -m json.tool
