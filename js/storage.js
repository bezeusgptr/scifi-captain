const SAVE_KEY = "scifi-captain-save-v1";
const SETTINGS_KEY = "scifi-captain-settings-v1";

export const defaultSettings = {
  timerSec: 180,
  apiBaseUrl: "",
  apiKey: "",
  model: "gpt-4o-mini",
  notify: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  const next = { ...defaultSettings, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(state) {
  try {
    const copy = { ...state, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
  } catch (err) {
    console.warn("save failed", err);
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function aiConfigured(settings) {
  const s = settings || loadSettings();
  return Boolean(s.apiBaseUrl && s.apiBaseUrl.trim() && s.apiKey && s.apiKey.trim() && s.model && s.model.trim());
}
