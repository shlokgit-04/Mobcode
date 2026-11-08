/**
 * Mobcode build-time configuration.
 *
 * PRODUCTION_API_BASE_URL is stamped by scripts/set-production-url.mjs when the
 * verified Render URL exists. A release build must never ship an empty or
 * placeholder value (the Android packaging script fails the build in that case
 * unless ANDROID_ALLOW_DEV_CONFIG=1).
 *
 * Developer override: dev builds may point the app at another backend with
 * localStorage["mobcode.dev-url"] or the Connect screen. Release builds keep
 * the override OFF (readonlyOverride) so the production URL always wins.
 */
export const MOBCODE_VERSION = "1.1.0";

/** Server URL set at build time from the verified Render deployment. */
export const PRODUCTION_API_BASE_URL = "https://mobcode.onrender.com";

/** Allow a developer-only server override from the Connect screen / localStorage. */
export const ALLOW_DEV_SERVER_OVERRIDE = false;

/** Exercise the resolved config. */
export function resolveApiBase({ secureProfileUrl = "" } = {}) {
  const devUrl = localStorage.getItem("mobcode.dev-url") || "";
  if (ALLOW_DEV_SERVER_OVERRIDE && devUrl.trim()) return { base: devUrl.trim().replace(/\/+$/, ""), source: "dev-override", locked: false };
  if (PRODUCTION_API_BASE_URL) {
    // Hard rule: the production endpoint wins in release builds because the
    // packaging stamp sets ALLOW_DEV_SERVER_OVERRIDE=false.
    return { base: PRODUCTION_API_BASE_URL.replace(/\/+$/, ""), source: "production", locked: !ALLOW_DEV_SERVER_OVERRIDE };
  }
  if (secureProfileUrl) return { base: secureProfileUrl.replace(/\/+$/, ""), source: "profile", locked: false };
  return { base: "", source: "unset", locked: false };
}
