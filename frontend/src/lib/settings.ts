const KEYS = {
  apiKey: "agenteval_api_key",
  baseUrl: "agenteval_base_url",
  model: "agenteval_model",
} as const;

export interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadSettings(): LLMSettings {
  return {
    apiKey: localStorage.getItem(KEYS.apiKey) ?? "",
    baseUrl: localStorage.getItem(KEYS.baseUrl) ?? "",
    model: localStorage.getItem(KEYS.model) ?? "gpt-4o-mini",
  };
}

export function saveSettings(s: LLMSettings): void {
  localStorage.setItem(KEYS.apiKey, s.apiKey);
  localStorage.setItem(KEYS.baseUrl, s.baseUrl);
  localStorage.setItem(KEYS.model, s.model);
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem(KEYS.apiKey);
}
