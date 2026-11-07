/** Formatting + display derivation helpers ("Do not invent" is enforced here:
 *  pricing/caps/context only come from actual API data). */

export function fmtContext(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${trimNum(n / 1_000_000)}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}

export function fmtOutputLimit(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${trimNum(n / 1_000_000)}M out`;
  if (n >= 1000) return `${Math.round(n / 1000)}K out`;
  return `${n} out`;
}

function trimNum(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, "");
}

/** Returns null when pricing data is unreliable/absent — never invent.
 *  v1 cost: [{input, output, cache:{read, write}}]; v2 cost: {input, output, cache_read, cache_write}. */
export function pricingLabel(model) {
  const raw = model?.cost;
  let c = null;
  if (Array.isArray(raw)) c = raw[0] ?? null;
  else if (raw && typeof raw === "object") c = raw;
  if (!c || typeof c?.input !== "number" || typeof c?.output !== "number") return null;
  const cacheRead = c.cache?.read ?? c.cache_read;
  const cacheWrite = c.cache?.write ?? c.cache_write;
  const free = c.input === 0 && c.output === 0 &&
    (cacheRead === undefined || cacheRead === 0) && (cacheWrite === undefined || cacheWrite === 0);
  if (free) return { kind: "free", label: "Free" };
  const f = (perM) => {
    if (!perM) return null;
    const usd = perM < 0.01 ? perM * 1000 : perM;
    const s = usd >= 1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "");
    return `$${s}${perM < 0.01 ? "/1K" : "/M"}`;
  };
  const i = f(c.input);
  const o = f(c.output);
  if (!i && !o) return null;
  const label = i && o ? `${i} in · ${o} out` : (i || o);
  return { kind: "paid", label };
}

export const INPUT_LABELS = { image: "Image", audio: "Audio", video: "Video", pdf: "PDF", text: null, other: null };

export function capabilityChips(model) {
  const caps = model?.capabilities;
  if (!caps) return [];
  const out = [];
  if (caps.tools || caps.tool_call) out.push("Tools");
  const inputs = new Set([...(caps.input || []), ...(model?.modalities?.input || [])]);
  if (inputs.has("image")) out.push("Image");
  if (inputs.has("audio")) out.push("Audio");
  if (inputs.has("video")) out.push("Video");
  if (inputs.has("pdf")) out.push("PDF");
  return out;
}

export function statusBadge(model) {
  const s = model?.status;
  if (!s || s === "active") return null;
  return { kind: s, label: s[0].toUpperCase() + s.slice(1) };
}

export function providersFromModels(models) {
  const map = new Map();
  for (const m of models || []) {
    const pid = m.providerID || "?";
    if (!map.has(pid)) map.set(pid, 0);
    map.set(pid, map.get(pid) + 1);
  }
  return [...map.entries()].map(([id, count]) => ({ id, count }));
}

export function matchesQuery(model, providerName, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    (model.name || "").toLowerCase().includes(s) ||
    (model.id || "").toLowerCase().includes(s) ||
    (model.providerID || "").toLowerCase().includes(s) ||
    (providerName || "").toLowerCase().includes(s) ||
    (model.family || "").toLowerCase().includes(s)
  );
}

export function fmtTokens(n) {
  if (!n || n < 1000) return `${n || 0}`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`;
}

export function fmtCostSession(n) {
  if (!n) return null;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = diff / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtTime(ts) {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
