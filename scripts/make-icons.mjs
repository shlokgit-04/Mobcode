#!/usr/bin/env node
/** Generates Mobcode icons (SVG source + PNG renders via ImageMagick `convert`). */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const icons = join(dirname(here), "public", "icons");
mkdirSync(icons, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="0.5" stop-color="#5b48d3"/>
      <stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="118" fill="url(#g)"/>
  <path d="M136 152h240a44 44 0 0 1 44 44v120a44 44 0 0 1-44 44H212l-76 56v-56a44 44 0 0 1-44-44V196a44 44 0 0 1 44-44z"
        fill="#0b0e14" fill-opacity="0.92"/>
  <path d="M190 218h180M190 262h132" stroke="#9fe8dd" stroke-width="26" stroke-linecap="round" fill="none"/>
  <circle cx="352" cy="352" r="52" fill="#2dd4bf"/>
  <path d="M352 318v68M318 352h68" stroke="#0b0e14" stroke-width="22" stroke-linecap="round"/>
</svg>`;

// maskable: same art, no rounding (full-bleed) + extra padding so 80% safe zone holds art
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(76.8,76.8) scale(0.7)">
    <path d="M136 152h240a44 44 0 0 1 44 44v120a44 44 0 0 1-44 44H212l-76 56v-56a44 44 0 0 1-44-44V196a44 44 0 0 1 44-44z" fill="#0b0e14" fill-opacity="0.92"/>
    <path d="M190 218h180M190 262h132" stroke="#9fe8dd" stroke-width="26" stroke-linecap="round" fill="none"/>
    <circle cx="352" cy="352" r="52" fill="#2dd4bf"/>
    <path d="M352 318v68M318 352h68" stroke="#0b0e14" stroke-width="22" stroke-linecap="round"/>
  </g>
</svg>`;

writeFileSync(join(icons, "icon.svg"), svg);
writeFileSync(join(icons, "icon-maskable.svg"), maskableSvg);

const renders = [
  ["icon.svg", "icon-180.png", 180],
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["icon-maskable.svg", "icon-512-maskable.png", 512],
];

for (const [src, dest, size] of renders) {
  try {
    execFileSync("convert", [
      "-background", "none", "-resize", `${size}x${size}`,
      join(icons, src), join(icons, dest),
    ], { stdio: "ignore" });
    console.log("wrote", dest);
  } catch {
    console.warn("ImageMagick missing — skipped", dest);
  }
}
console.log("icons done");
