#!/usr/bin/env bash
# webpane.sh — 直接经 Host 桥操作 DSH 右侧栏的 Murdoku 面板（工具 webpane 不可用时的退路）
#
#   ./webpane.sh state
#   ./webpane.sh open /play/puzzle-book-club-very-easy
#   ./webpane.sh text 4000
#   ./webpane.sh eval-file /tmp/probe.js
#   ./webpane.sh eval 'JSON.stringify({path:location.pathname})'
#   ./webpane.sh click '{"text":"提交"}'
#
# 环境变量：DSH_SESSION_ID（必填，决定路由到哪个 session 的面板）
#           WEBPANE_BASE（默认 http://127.0.0.1:3080）
set -euo pipefail

BASE="${WEBPANE_BASE:-http://127.0.0.1:3080}"
: "${DSH_SESSION_ID:?需要 DSH_SESSION_ID（本 session 的 id）}"

ACTION="${1:-state}"
shift || true

case "$ACTION" in
  eval-file)
    FILE="${1:?用法: webpane.sh eval-file <file.js>}"
    python3 - "$FILE" <<'PY' > /tmp/webpane-request.json
import json, os, sys
code = open(sys.argv[1], encoding='utf-8').read()
print(json.dumps({"action": "eval", "payload": {"code": code}, "session": os.environ["DSH_SESSION_ID"]}))
PY
    ;;
  eval)
    CODE="${1:?用法: webpane.sh eval '<js>'}"
    python3 - "$CODE" <<'PY' > /tmp/webpane-request.json
import json, os, sys
print(json.dumps({"action": "eval", "payload": {"code": sys.argv[1]}, "session": os.environ["DSH_SESSION_ID"]}))
PY
    ;;
  open)
    URL="${1:?用法: webpane.sh open /play/puzzle-xxx}"
    python3 - "$URL" <<'PY' > /tmp/webpane-request.json
import json, os, sys
print(json.dumps({"action": "open", "payload": {"url": sys.argv[1]}, "session": os.environ["DSH_SESSION_ID"]}))
PY
    ;;
  text)
    LIMIT="${1:-6000}"
    python3 - "$LIMIT" <<'PY' > /tmp/webpane-request.json
import json, os, sys
print(json.dumps({"action": "text", "payload": {"limit": int(sys.argv[1])}, "session": os.environ["DSH_SESSION_ID"]}))
PY
    ;;
  *)
    # 其余动作：第二个参数是 JSON payload（可省略）
    PAYLOAD="${1:-}"
    if [ -z "$PAYLOAD" ]; then PAYLOAD='{}'; fi
    python3 - "$ACTION" "$PAYLOAD" <<'PY' > /tmp/webpane-request.json
import json, os, sys
action, payload = sys.argv[1], sys.argv[2]
print(json.dumps({"action": action, "payload": json.loads(payload), "session": os.environ["DSH_SESSION_ID"]}))
PY
    ;;
esac

curl -s -X POST -H 'content-type: application/json' \
  --data-binary @/tmp/webpane-request.json \
  --max-time "${WEBPANE_TIMEOUT:-60}" \
  "$BASE/__webpane/cli" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    body = json.loads(raw)
except Exception:
    print(raw)
    raise SystemExit(0)
if not body.get("ok"):
    print("ERROR:", body.get("error", body))
    raise SystemExit(1)
value = body.get("value")
# eval 的结果会被再编码一层
for _ in range(2):
    if not isinstance(value, str):
        break
    try:
        value = json.loads(value)
    except Exception:
        break
print(json.dumps(value, ensure_ascii=False, indent=2) if not isinstance(value, str) else value)
'
