#!/usr/bin/env bash
set -euo pipefail

# Sync host fonts into the OnlyOffice DocumentServer container to improve WYSIWYG fidelity vs Microsoft Word.
#
# Why:
# - Even with open-source CJK fonts installed, templates authored in Word often rely on system/proprietary fonts
#   (e.g. PingFang SC on macOS). Without those fonts, OnlyOffice must substitute -> layout drift.
# - This script copies fonts from your host into the container's persistent custom fonts volume and rebuilds caches.
#
# Safety:
# - Fonts are NOT committed to this repo. This is for local dev only.
# - Ensure you have rights to use the fonts you copy.
#
# Usage:
#   ./scripts/onlyoffice-sync-host-fonts.sh [container_name]
#
# Options:
#   --all         Copy all fonts from the host directories (can be large).
#   --no-restart  Don't restart the container after syncing.
#

RESTART=1
COPY_ALL=0
CONTAINER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-restart)
      RESTART=0
      shift
      ;;
    --all)
      COPY_ALL=1
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      CONTAINER="$1"
      shift
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

detect_container() {
  local names
  names="$(docker ps --format '{{.Names}}' || true)"
  if echo "$names" | grep -qx 'opencode-onlyoffice-1'; then
    echo "opencode-onlyoffice-1"
    return
  fi
  if echo "$names" | grep -qx 'onlyoffice'; then
    echo "onlyoffice"
    return
  fi
  echo "opencode-onlyoffice-1"
}

if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(detect_container)"
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "OnlyOffice container not running: $CONTAINER" >&2
  echo "Tip: start it with docker compose or your dev stack, then rerun." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="$ROOT_DIR/tmp/onlyoffice-host-fonts"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

declare -a FONT_DIRS=()
if [[ "${OSTYPE:-}" == darwin* ]]; then
  FONT_DIRS+=("$HOME/Library/Fonts" "/Library/Fonts" "/System/Library/Fonts")
elif [[ "${OSTYPE:-}" == linux* ]]; then
  FONT_DIRS+=("$HOME/.local/share/fonts" "/usr/local/share/fonts" "/usr/share/fonts")
else
  FONT_DIRS+=("$HOME/Library/Fonts" "$HOME/.local/share/fonts" "/usr/share/fonts")
fi

match_font() {
  local base
  base="$(basename "$1")"
  # Default: only sync common Chinese font families that affect bid templates.
  # Use --all to sync everything.
  echo "$base" | grep -Eqi '(PingFang|STHeiti|STSong|STFangsong|STKaiti|Songti|Heiti|Kaiti|FangSong|DengXian|SimSun|SimHei|YaHei|Microsoft|HY|HanYi|Hanyi|FZ|FangZheng|方正|汉仪)'
}

echo "[onlyoffice] Syncing host fonts -> container: $CONTAINER" >&2
echo "[onlyoffice] Staging dir: $STAGING_DIR" >&2

found=0
for dir in "${FONT_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    if [[ "$COPY_ALL" == "0" ]] && ! match_font "$file"; then
      continue
    fi
    cp -n "$file" "$STAGING_DIR/" 2>/dev/null || true
    found=1
  done < <(find "$dir" -type f \( -iname '*.ttf' -o -iname '*.otf' -o -iname '*.ttc' -o -iname '*.otc' \) -print0 2>/dev/null || true)
done

if [[ "$found" != "1" ]]; then
  echo "[onlyoffice] No fonts matched. Try --all or install fonts into ~/Library/Fonts." >&2
  exit 1
fi

echo "[onlyoffice] Copying into container font volume..." >&2
docker exec "$CONTAINER" bash -lc 'set -euo pipefail
mkdir -p /usr/share/fonts/truetype/custom
rm -rf /usr/share/fonts/truetype/custom/host
mkdir -p /usr/share/fonts/truetype/custom/host
'

docker cp "$STAGING_DIR/." "$CONTAINER:/usr/share/fonts/truetype/custom/host" >/dev/null

docker exec "$CONTAINER" bash -lc 'set -euo pipefail
fc-cache -f >/dev/null
if command -v documentserver-generate-allfonts.sh >/dev/null 2>&1; then
  documentserver-generate-allfonts.sh >/dev/null 2>&1 || true
fi
echo "OK: host fonts synced"
echo "fc-match 苹方-简 => $(fc-match "苹方-简" || true)"
echo "fc-match PingFang SC => $(fc-match "PingFang SC" || true)"
echo "fc-match 宋体 => $(fc-match "宋体" || true)"
echo "fc-match 微软雅黑 => $(fc-match "微软雅黑" || true)"
'

if [[ "$RESTART" == "1" ]]; then
  echo "[onlyoffice] Restarting container: $CONTAINER" >&2
  docker restart "$CONTAINER" >/dev/null
  echo "[onlyoffice] Restarted." >&2
else
  echo "[onlyoffice] Skipping restart (--no-restart)." >&2
fi

echo "[onlyoffice] Done." >&2

