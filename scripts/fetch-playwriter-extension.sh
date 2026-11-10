#!/usr/bin/env bash
# 重新下载 Playwriter 浏览器扩展（Chrome「加载已解压的扩展程序」用的那份目录）。
#
# 这个目录不入库：npm 包 playwriter 里内置了同一个扩展
# （package/dist/extension），丢了就跑本脚本从 npm registry 重新拉下来，
# 还原到仓库根目录的 playwriter-extension/，Chrome 里扩展 ID 保持不变
# （manifest 带 key，ID 由 key 决定 → pebbngnfojnignonigcnkdilknapkgid）。
#
# 用法：
#   scripts/fetch-playwriter-extension.sh                 # 默认 0.10.0（内置扩展 0.0.171）
#   PLAYWRITER_VERSION=0.10.0 scripts/fetch-playwriter-extension.sh
#   PLAYWRITER_VERSION=latest scripts/fetch-playwriter-extension.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_DIR/playwriter-extension"
VERSION="${PLAYWRITER_VERSION:-0.10.0}"

if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL --max-time 30 https://registry.npmjs.org/playwriter/latest \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/playwriter-ext.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

URL="https://registry.npmjs.org/playwriter/-/playwriter-${VERSION}.tgz"
echo "→ 下载 playwriter@${VERSION}: $URL"
curl -fsSL --max-time 120 "$URL" -o "$TMP_DIR/playwriter.tgz"

echo "→ 解出 package/dist/extension"
tar -xzf "$TMP_DIR/playwriter.tgz" -C "$TMP_DIR" package/dist/extension

rm -rf "$DEST"
cp -R "$TMP_DIR/package/dist/extension" "$DEST"

# 校验：manifest 可解析、扩展 ID 与 Chrome 里原来的注册一致
node --input-type=module - "$DEST" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const expectedId = 'pebbngnfojnignonigcnkdilknapkgid' // Chrome 里原来的扩展 ID
const der = Buffer.from(manifest.key, 'base64')
const id = crypto
  .createHash('sha256')
  .update(der)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))

const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const files = walk(dir).length
console.log(`  name    : ${manifest.name}`)
console.log(`  version : ${manifest.version}`)
console.log(`  files   : ${files}`)
console.log(`  ext id  : ${id}${id === expectedId ? '  ✓ 与 Chrome 注册一致' : `  ✗ 与期望 ${expectedId} 不一致`}`)
if (id !== expectedId) process.exit(1)
NODE

echo "✓ 已还原到 $DEST"
echo "  Chrome → chrome://extensions → 开发者模式 → 「加载已解压的扩展程序」→ 选这个目录"
