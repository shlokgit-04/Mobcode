/** Tiny observable store + persisted prefs. */

const PREFS_KEY = "mobcode.prefs.v1";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

const saved = loadPrefs();

export const store = new (class {
  constructor() {
    this.state = {
      host: { companion: false, staticOnly: true, connected: false, hasPassword: false, directory: "" },
      target: "",            // direct OpenCode URL when not proxied
      directory: saved.directory ?? "",
      password: "",          // direct-mode only, session-only (never persisted)
      connected: false,      // verified health check

      models: null,          // [] from /api/model
      providers: [],         // from /api/provider (configured providers)
      integrations: [],      // from /api/integration (connect methods per provider)
      credentials: [],       // from /api/credential (stored credentials)
      connectedProviderIds: [],
      globalDefaultModel: null, // provider/id from /api/model/default

      agents: [],

      sessions: [],
      activeSessionId: null,
      sessionCache: new Map(), // sessionID -> SessionV2Info
      messageCache: new Map(), // sessionID -> [messages]

      sseStatus: "init",     // init|connected|disconnected|error
      authMode: "bearer",    // bearer | basic (direct engine connections)

      // model picker ui state
      modelQuery: "",
      modelProviderFilter: null,
      pendingModel: null,      // ModelRef while awaiting confirmation
      recents: saved.recents ?? [],         // [ModelRef-ish {providerID,id,variant?,at,name,providerName}]
      variantChoice: {},       // modelKey -> variant id
      agentsChoice: null,
    };
    this.subs = new Set();
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit();
  }

  emit() { for (const fn of this.subs) fn(this.state); }

  persistPrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          recents: this.state.recents.slice(0, 8),
          directory: this.state.directory,
        })
      );
    } catch {}
  }

  rememberModel(ref, label) {
    const key = modelKey(ref);
    const entry = { ...ref, at: Date.now(), label };
    const next = [entry, ...this.state.recents.filter((r) => modelKey(r) !== key)].slice(0, 8);
    this.set({ recents: next });
    this.persistPrefs();
  }

  setVariantChoice(modelKey, variant) {
    const next = { ...this.state.variantChoice, [modelKey]: variant || undefined };
    this.set({ variantChoice: next });
  }
})();

export function modelKey(ref) {
  return (ref ? `${ref.providerID}/${ref.id}${ref.variant ? `@${ref.variant}` : ""}` : "").toLowerCase();
}

export function modelBaseKey(ref) {
  return ref ? `${ref.providerID}/${ref.id}`.toLowerCase() : "";
}
