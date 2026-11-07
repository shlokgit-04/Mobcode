#!/usr/bin/env node
/* Headless Chromium checks for Mobcode via CDP + puppeteer-core if available,
 * otherwise falls back to raw CDP over websocket using `chromium --remote-debugging-port`.
 * Simpler: use Chromium's --dump-dom / --virtual-time-budget to render the SPA. */
import { spawn, execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:8090";
const CHROME = "/usr/bin/chromium";

const flags = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--enable-logging=stderr",
  "--v=0",
];

async function dumpDom(url, ms = 6000) {
  const out = await new Promise((resolve, reject) => {
    const p = spawn(CHROME, [...flags, `--virtual-time-budget=${ms}`, `--dump-dom`, url], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("exit", (code) => {
      if (stdout.trim().length || code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(-2200)));
    });
    setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, ms + 8000);
  });
  return out;
}

const url = process.argv[2] || "/";
const budget = Number(process.argv[3] || 6000);
const { stdout, stderr } = await dumpDom(new URL(url, BASE).href, budget);
console.log(stdout);
const errs = stderr.split("\n").filter((l) => /console.*error|Uncaught|error:/i.test(l) && !/ Bach|GPU|dbus|SwapContext|dawn|Viz|Registerni/.test(l));
if (errs.length) {
  console.error("---- PAGE ERRORS ----");
  console.error(errs.slice(-14).join("\n"));
  process.exit(3);
}
