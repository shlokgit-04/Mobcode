#!/usr/bin/env bash
# Play Store artwork: 512x512 app icon + 1024x500 feature graphic,
# generated from the existing Mobcode brand assets (assets/).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/dist/meta"
cd "$ROOT"

# icon: exact 512x512 PNG32 required by Play listing
convert "$ROOT/assets/icon.png" -resize 512x512! "$ROOT/dist/meta/icon-512.png"

# feature graphic: 1024x500 with brand gradient + wordmark
cat > /tmp/opencode/feature.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="500" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0b0e14"/>
      <stop offset="1" stop-color="#161b28"/>
    </linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="480" y2="480" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="0.5" stop-color="#5b48d3"/>
      <stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  <g transform="translate(96,110) scale(0.58)">
    <rect x="0" y="0" width="480" height="480" rx="112" fill="url(#g)"/>
    <path d="M96 112h288a52 52 0 0 1 52 52v144a52 52 0 0 1-52 52H252l-88 64v-64a52 52 0 0 1-52-52V164a52 52 0 0 1 52-52z"
          fill="#0b0e14" fill-opacity="0.92"/>
    <path d="M152 180h216M152 232h152" stroke="#9fe8dd" stroke-width="30" stroke-linecap="round" fill="none"/>
    <circle cx="416" cy="416" r="60" fill="#2dd4bf"/>
    <path d="M416 376v80M376 416h80" stroke="#0b0e14" stroke-width="26" stroke-linecap="round"/>
  </g>
  <text x="520" y="230" font-family="DejaVu Sans, Arial, sans-serif" font-size="86" font-weight="bold" fill="#e8ebf4">Mobcode</text>
  <text x="524" y="296" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="#727c92" letter-spacing="2">YOUR CODE. YOUR AGENT. ANYWHERE.</text>
</svg>
SVG
/usr/bin/chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=1024,500 --screenshot="$ROOT/dist/meta/feature-graphic.png" \
  "file:///tmp/opencode/feature.svg" >/dev/null 2>&1

identify "$ROOT/dist/meta/icon-512.png" "$ROOT/dist/meta/feature-graphic.png"
