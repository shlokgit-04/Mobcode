#!/usr/bin/env node
/**
 * Mobcode Android packaging prep.
 *
 * Copies the existing, unchanged PWA front-end (./public) into ./www as the
 * Capacitor web root, and stamps a build manifest so the app can display its
 * packaging info. Nothing in public/ is modified.
 */
import { cpSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

mkdirSync(join(root, "www"), { recursive: true });
rmSync(join(root, "www"), { recursive: true, force: true });
mkdirSync(join(root, "www"), { recursive: true });
cpSync(join(root, "public"), join(root, "www"), { recursive: true });

writeFileSync(
  join(root, "www", "mobcode-build.json"),
  JSON.stringify(
    {
      app: "Mobcode",
      version: pkg.version,
      platform: "android",
      client: "capacitor-8",
      builtAt: new Date().toISOString(),
    },
    null,
    2
  )
);

// sanity: every referenced asset exists
for (const f of ["index.html", "sw.js", "manifest.webmanifest", "app/js/main.js", "app/css/app.css"]) {
  if (!existsSync(join(root, "www", f))) {
    console.error("MISSING in www:", f);
    process.exit(1);
  }
}
console.log("www/ ready");
