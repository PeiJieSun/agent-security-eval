export interface LLMProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
}

const STORAGE_KEY = "agenteval_profiles";

// ── CRUD ──────────────────────────────────────────────────────────────────

export function loadProfiles(): LLMProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: LLMProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function addProfile(p: Omit<LLMProfile, "id">): LLMProfile {
  const profiles = loadProfiles();
  const id = "p_" + Math.random().toString(36).slice(2, 8);
  const next: LLMProfile = { ...p, id };
  // If first profile, make it active
  if (profiles.length === 0) next.isActive = true;
  saveProfiles([...profiles, next]);
  return next;
}

export function updateProfile(updated: LLMProfile): void {
  const profiles = loadProfiles().map((p) => (p.id === updated.id ? updated : p));
  saveProfiles(profiles);
}

export function deleteProfile(id: string): void {
  const profiles = loadProfiles().filter((p) => p.id !== id);
  // If we deleted the active one, activate the first remaining
  if (profiles.length > 0 && !profiles.some((p) => p.isActive)) {
    profiles[0].isActive = true;
  }
  saveProfiles(profiles);
}

export function setActiveProfile(id: string): void {
  const profiles = loadProfiles().map((p) => ({ ...p, isActive: p.id === id }));
  saveProfiles(profiles);
}

export function getActiveProfile(): LLMProfile | null {
  const profiles = loadProfiles();
  return profiles.find((p) => p.isActive) ?? profiles[0] ?? null;
}

// ── Backward-compat shim for NewEval ─────────────────────────────────────

export interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadSettings(): LLMSettings {
  const p = getActiveProfile();
  return p
    ? { apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.model }
    : { apiKey: "", baseUrl: "", model: "gpt-4o-mini" };
}

export function hasApiKey(): boolean {
  const p = getActiveProfile();
  return !!p?.apiKey;
}

// ── API Key helpers ───────────────────────────────────────────────────────

/** Returns "sk-abc…xyz1" style preview. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return key.slice(0, 3) + "…";
  return key.slice(0, 7) + "…" + key.slice(-4);
}
