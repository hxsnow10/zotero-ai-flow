"use strict";

const PREF_PREFIX = "extensions.zotero-ai-flow.";

window.addEventListener("load", () => {
  loadPrefs();
  attachSaveListeners();
});

function loadPrefs() {
  for (const el of document.querySelectorAll("[data-pref]")) {
    const key = PREF_PREFIX + el.dataset.pref;
    try {
      const val = Zotero.Prefs.get(key, true);
      if (val === undefined) continue;
      if (el.type === "checkbox") {
        el.checked = val;
      } else {
        el.value = val;
      }
    } catch (e) {
      // Leave placeholder
    }
  }
}

function attachSaveListeners() {
  for (const el of document.querySelectorAll("[data-pref]")) {
    el.addEventListener("change", () => savePref(el));
  }
}

function savePref(el) {
  const key = PREF_PREFIX + el.dataset.pref;
  const val = el.type === "checkbox" ? el.checked : el.value;
  try {
    Zotero.Prefs.set(key, val, true);
  } catch (e) {
    Zotero.debug("[ZoteroAIFlow] Failed to save pref " + key + ": " + e);
  }
}
