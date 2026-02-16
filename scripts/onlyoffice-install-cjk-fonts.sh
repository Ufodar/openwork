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

cat > /etc/fonts/conf.d/99-openwork-cjk-aliases.conf <<"EOF"
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <!-- Serif (Song) -->
  <alias>
    <family>宋体</family>
    <prefer>
      <family>Noto Serif CJK SC</family>
      <family>AR PL UMing CN</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>新宋体</family>
    <prefer>
      <family>Noto Serif CJK SC</family>
      <family>AR PL UMing CN</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>SimSun</family>
    <prefer>
      <family>Noto Serif CJK SC</family>
      <family>AR PL UMing CN</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>NSimSun</family>
    <prefer>
      <family>Noto Serif CJK SC</family>
      <family>AR PL UMing CN</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>

  <!-- Sans (Hei/Deng) -->
  <alias>
    <family>黑体</family>
    <prefer>
      <family>Noto Sans CJK SC</family>
      <family>WenQuanYi Zen Hei</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>SimHei</family>
    <prefer>
      <family>Noto Sans CJK SC</family>
      <family>WenQuanYi Zen Hei</family>
      <family>WenQuanYi Micro Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>等线</family>
    <prefer>
      <family>Noto Sans CJK SC</family>
      <family>WenQuanYi Micro Hei</family>
      <family>WenQuanYi Zen Hei</family>
    </prefer>
  </alias>
  <alias>
    <family>DengXian</family>
    <prefer>
      <family>Noto Sans CJK SC</family>
      <family>WenQuanYi Micro Hei</family>
      <family>WenQuanYi Zen Hei</family>
    </prefer>
  </alias>

  <!-- Kai -->
  <alias>
    <family>楷体</family>
    <prefer>
      <family>AR PL UKai CN</family>
      <family>Noto Serif CJK SC</family>
    </prefer>
  </alias>
  <alias>
    <family>KaiTi</family>
    <prefer>
      <family>AR PL UKai CN</family>
      <family>Noto Serif CJK SC</family>
    </prefer>
  </alias>
</fontconfig>
EOF

fc-cache -f >/dev/null
echo "OK: fonts installed + aliases configured"
echo "fc-match 宋体 => $(fc-match "宋体")"
echo "fc-match 等线 => $(fc-match "等线")"
echo "fc-match 黑体 => $(fc-match "黑体")"
echo "fc-match 楷体 => $(fc-match "楷体")"
'

if [[ "$RESTART" == "1" ]]; then
  echo "[onlyoffice] Restarting container: $CONTAINER" >&2
  docker restart "$CONTAINER" >/dev/null
  echo "[onlyoffice] Restarted." >&2
else
  echo "[onlyoffice] Skipping restart (--no-restart)." >&2
fi

