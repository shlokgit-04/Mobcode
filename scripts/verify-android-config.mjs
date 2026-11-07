#!/usr/bin/env node
/**
 * Android packaging gate (run from scripts/package-android.sh before gradle).
 *
 * Reads the stamped values in www/app/js/config.js (the copy packaged into
 * the APK) and refuses to produce a release artifact unless:
 *   - PRODUCTION_API_BASE_URL is a real https:// Mobcode URL, and
 *   - ALLOW_DEV_SERVER_OVERRIDE is false (the production URL always wins).
 *
 * Escape hatch for local development builds only:
 *   ANDROID_ALLOW_DEV_CONFIG=1 bash scripts/package-android.sh
 * which allows an unstamped URL / dev override, and labels the artifacts as
 * dev builds instead of shipping them silently.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowDev = process.env.ANDROID_ALLOW_DEV_CONFIG === "1";
const src = readFileSync(join(root, "www", "app", "js", "config.js"), "utf8");

const pick = (name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*("([^"]*)"|true|false)`));
  if (!m) return null;
  return { raw: m[1], string: m[2] ?? undefined };
};

const url = pick("PRODUCTION_API_BASE_URL");
const override = pick("ALLOW_DEV_SERVER_OVERRIDE");

if (!url || override === null) {
  console.error("Packaging gate cannot read www/app/js/config.js — is prepare-android.mjs up to date?");
  process.exit(1);
}

const stamped = Boolean(url.string);
const devOverrideOn = override.raw === "true";

if (stamped && url.string.startsWith("https://") && !devOverrideOn) {
  console.log(`Packaging gate: OK — production URL "${url.string}", dev override off.`);
  process.exit(0);
}

if (allowDev) {
  console.warn("Packaging gate: DEV-CONFIG build (ANDROID_ALLOW_DEV_CONFIG=1).");
  console.warn(`  PRODUCTION_API_BASE_URL = ${stamped ? `"${url.string}"` : "(unset)"}`);
  console.warn(`  ALLOW_DEV_SERVER_OVERRIDE = ${devOverrideOn}`);
  console.warn("  Never distribute these artifacts — they are for local testing only.");
  process.exit(0);
}

console.error("Packaging gate: REFUSING to build a release with dev config.");
console.error("  Stamp the verified Render URL first:");
console.error("    node scripts/set-production-url.mjs https://<your-service>.onrender.com");
console.error("  (For local-dev-only builds: ANDROID_ALLOW_DEV_CONFIG=1 bash scripts/package-android.sh)");
process.exit(1);
