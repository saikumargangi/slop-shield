// Slop Shield v0.1 — popup: toggles, mode, stats, blocked/learned lists.
(function () {
  "use strict";

  const DEFAULTS = { enabled: true, youtube: true, etsy: true, mode: "hide", strict: false, shortsAi: true, skipShorts: true };

  const $ = (id) => document.getElementById(id);

  async function readSettings() {
    const o = await chrome.storage.local.get("settings");
    return { ...DEFAULTS, ...(o.settings || {}) };
  }

  async function writeSettings(patch) {
    const s = await readSettings();
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
  }

  function removeBtn(store, key) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rm";
    b.textContent = "\u00D7";
    b.title = "Remove";
    b.addEventListener("click", async () => {
      try {
        const o = await chrome.storage.local.get(store);
        const m = o[store] || {};
        delete m[key];
        await chrome.storage.local.set({ [store]: m });
        load();
      } catch (e) {}
    });
    return b;
  }

  function renderList(ul, map, withCount, store) {
    ul.textContent = "";
    const keys = Object.keys(map || {}).sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
    if (!keys.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "None yet";
      ul.appendChild(li);
      return;
    }
    for (const key of keys) {
      const rec = map[key] || {};
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "name";
      span.title = key;
      span.textContent = withCount ? (rec.name || key) + " · " + (rec.count || 0) : (rec.name || key);
      li.appendChild(span);
      li.appendChild(removeBtn(store, key));
      ul.appendChild(li);
    }
  }

  async function load() {
    try {
      const o = await chrome.storage.local.get(["settings", "stats", "blocked", "learned", "allowed"]);
      const s = { ...DEFAULTS, ...(o.settings || {}) };
      $("tEnabled").checked = !!s.enabled;
      $("tYoutube").checked = !!s.youtube;
      $("tEtsy").checked = !!s.etsy;
      $("tStrict").checked = !!s.strict;
      $("tShortsAi").checked = !!s.shortsAi;
      $("tSkipShorts").checked = !!s.skipShorts;
      $("mode").value = s.mode === "blur" ? "blur" : "hide";
      $("hiddenTotal").textContent = (o.stats && o.stats.hiddenTotal) || 0;
      renderList($("blockedList"), o.blocked || {}, false, "blocked");
      renderList($("learnedList"), o.learned || {}, true, "learned");
      renderList($("allowedList"), o.allowed || {}, false, "allowed");
    } catch (e) {}
  }

  function bindToggle(id, key) {
    $(id).addEventListener("change", (e) => {
      writeSettings({ [key]: e.target.checked }).catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindToggle("tEnabled", "enabled");
    bindToggle("tYoutube", "youtube");
    bindToggle("tEtsy", "etsy");
    bindToggle("tStrict", "strict");
    bindToggle("tShortsAi", "shortsAi");
    bindToggle("tSkipShorts", "skipShorts");
    $("mode").addEventListener("change", (e) => {
      writeSettings({ mode: e.target.value === "blur" ? "blur" : "hide" }).catch(() => {});
    });
    load();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") load();
      });
    } catch (e) {}
  });
})();
