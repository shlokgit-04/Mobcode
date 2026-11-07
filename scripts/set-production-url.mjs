#!/usr/bin/env node
/**
 * Stamp the verified Render production URL into public/app/js/config.js.
 *
 * Usage:
 *   node scripts/set-production-url.mjs https://mobcode-xxxx.onrender.com
 *   node scripts/set-production-url.mjs --revert          (back to unset/dev)
 *   node scripts/set-production-url.mjs <url> --keep-override
 *       (dev-override stays on — dev convenience, NEVER for release builds)
 *
 * The Android packaging script refuses to build a release with an unstamped
 * URL or with the dev override left enabled (scripts/verify-android-config.mjs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "public", "app", "js", "config.js");

const args = process.argv.slice(2);
const revert = args.includes("--revert");
const keepOverride = args.includes("--keep-override");
const url = args.find((a) => a.startsWith("https://")) || args.find((a) => !a.startsWith("--"));

let src = readFileSync(file, "utf8");

function replaceValue(name, value) {
  const re = new RegExp(`(export const ${name}\\s*=)\\s*(".*?"|true|false)`);
  if (!re.test(src)) {
    console.error(`config.js: ${name} declaration not found`);
    process.exit(1);
  }
  src = src.replace(re, `$1 ${value}`);
}

if (revert) {
  replaceValue("PRODUCTION_API_BASE_URL", '""');
  replaceValue("ALLOW_DEV_SERVER_OVERRIDE", "true");
  writeFileSync(file, src);
  console.log("config.js reverted to dev-unstamped state (PRODUCTION_API_BASE_URL=\"\", override on).");
  process.exit(0);
}

if (!url) {
  console.error("Usage: node scripts/set-production-url.mjs <https://render-url>");
  process.exit(1);
}

// hard validation — no placeholders, no guessing, https only
const clean = url.trim().replace(/\/+$/, "");
let parsed;
try {
  parsed = new URL(clean);
} catch {
  console.error(`Not a valid URL: ${clean}`);
  process.exit(1);
}
if (parsed.protocol !== "https:") {
  console.error(`Refusing non-https production URL: ${clean}`);
  process.exit(1);
}
if (/localhost|127\.0\.0\.1|0\.0\.0\.0|example\.|placeholder|your-backend/i.test(clean)) {
  console.error(`Refusing placeholder URL: ${clean}`);
  process.exit(1);
}

// verify the URL actually reaches a Mobcode server before stamping
console.log(`Probing ${clean}/health …`);
let probe;
try {
  const res = await fetch(`${clean}/health`, { signal: AbortSignal.timeout(15000) });
  probe = await res.json();
} catch (err) {
  console.error(`Could not reach ${clean}/health (${err.message}).`);
  console.error("Stamping refused — deploy to Render first, then run this script with the real URL.");
  process.exit(1);
}
if (probe?.service !== "mobcode" || probe?.ok !== true) {
  console.error(`${clean} answered, but not as a Mobcode server: ${JSON.stringify(probe).slice(0, 200)}`);
  console.error("Stamping refused.");
  process.exit(1);
}
console.log(`Verified: Mobcode ${probe.version}, uptime ${probe.uptime}s. Stamping URL.`);

replaceValue("PRODUCTION_API_BASE_URL", `"${clean}"`);
replaceValue("ALLOW_DEV_SERVER_OVERRIDE", keepOverride ? "true" : "false");
writeFileSync(file, src);

console.log("\nconfig.js stamped:");
console.log(`  PRODUCTION_API_BASE_URL = "${clean}"`);
console.log(`  ALLOW_DEV_SERVER_OVERRIDE = ${keepOverride ? "true (dev build only!)" : "false"}`);
