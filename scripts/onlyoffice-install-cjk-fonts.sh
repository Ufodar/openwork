#!/usr/bin/env bash
set -euo pipefail

# Install CJK fonts + fontconfig aliases into an existing OnlyOffice DocumentServer container.
#
# Why:
# - Bid/tender templates often use Microsoft Chinese fonts (宋体/等线/黑体/楷体).
# - OnlyOffice Docker images typically don't ship with these fonts.
# - Result: heavy font substitution -> layout drift, “潦草/不工整” compared to Word.
#
# This script installs open-source CJK fonts (Noto/WenQuanYi/Arphic) and
# configures fontconfig aliases so common Chinese font family names map to them.
#
# Usage:
#   ./scripts/onlyoffice-install-cjk-fonts.sh [container_name]
#
# Options:
#   --no-restart   Don't restart the container after installing fonts.
#
# Notes:
# - This modifies the running container filesystem (good for local dev).
# - For production, prefer building a derived image with these packages baked in.

RESTART=1
CONTAINER="${1:-opencode-onlyoffice-1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALIAS_CONFIG_SOURCE="$ROOT_DIR/packaging/onlyoffice/99-openwork-cjk-aliases.conf"

if [[ "${1:-}" == "--no-restart" ]]; then
  RESTART=0
  CONTAINER="${2:-opencode-onlyoffice-1}"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if [[ -z "$CONTAINER" ]]; then
  echo "Missing container name" >&2
  exit 1
fi

if [[ ! -f "$ALIAS_CONFIG_SOURCE" ]]; then
  echo "Missing font alias config: $ALIAS_CONFIG_SOURCE" >&2
  exit 1
fi

echo "[onlyoffice] Installing fonts in container: $CONTAINER" >&2

docker exec "$CONTAINER" bash -lc 'set -euo pipefail
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  fonts-noto-cjk \
  fonts-wqy-microhei \
  fonts-wqy-zenhei \
  fonts-arphic-ukai \
  fonts-arphic-uming \
  >/dev/null
'

docker cp "$ALIAS_CONFIG_SOURCE" "$CONTAINER:/etc/fonts/conf.d/99-openwork-cjk-aliases.conf" >/dev/null

docker exec "$CONTAINER" bash -lc 'set -euo pipefail
fc-cache -f >/dev/null
if command -v documentserver-generate-allfonts.sh >/dev/null 2>&1; then
  documentserver-generate-allfonts.sh >/dev/null 2>&1 || true
fi
echo "OK: fonts installed + aliases configured"
echo "fc-match 宋体 => $(fc-match "宋体")"
echo "fc-match 等线 => $(fc-match "等线")"
echo "fc-match 黑体 => $(fc-match "黑体")"
echo "fc-match 楷体 => $(fc-match "楷体")"
echo "fc-match 楷体_GB2312 => $(fc-match "楷体_GB2312")"
echo "fc-match 仿宋_GB2312 => $(fc-match "仿宋_GB2312")"
echo "fc-match 苹方-简 => $(fc-match "苹方-简")"
echo "fc-match .AppleSystemUIFont => $(fc-match ".AppleSystemUIFont")"
'

if [[ "$RESTART" == "1" ]]; then
  echo "[onlyoffice] Restarting container: $CONTAINER" >&2
  docker restart "$CONTAINER" >/dev/null
  echo "[onlyoffice] Restarted." >&2
else
  echo "[onlyoffice] Skipping restart (--no-restart)." >&2
fi
