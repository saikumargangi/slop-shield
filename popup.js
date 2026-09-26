// Slop Shield v1.0 — popup: toggles, mode, stats, blocked/learned lists.
(function () {
  "use strict";

  const DEFAULTS = { enabled: true, mode: "hide", strict: false, shortsAi: true, skipShorts: true };

  const $ = (id) => document.getElementById(id);

  async function readSettings() {
    const o = await chrome.storage.local.get("settings");
    return { ...DEFAULTS, ...(o.settings || {}) };
  }

  async function writeSettings(patch) {
    const s = await readSettings();
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
  }

  function setStatus(enabled) {
    const pill = $("statusPill");
    if (!pill) return;
    pill.classList.toggle("on", enabled);
    $("statusText").textContent = enabled ? "Protecting" : "Paused";
    const card = $("settingsCard");
    if (card) card.classList.toggle("dimmed", !enabled);
  }

  function removeBtn(store, key) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rm";
    b.textContent = "\u00D7";
    b.title = "Remove";
    b.setAttribute("aria-label", "Remove " + (key || ""));
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
      return 0;
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
    return keys.length;
  }

  async function load() {
    try {
      const o = await chrome.storage.local.get(["settings", "stats", "blocked", "learned", "allowed"]);
      const s = { ...DEFAULTS, ...(o.settings || {}) };
      $("tEnabled").checked = !!s.enabled;
      $("tStrict").checked = !!s.strict;
      $("tShortsAi").checked = !!s.shortsAi;
      $("tSkipShorts").checked = !!s.skipShorts;
      $("mode").value = s.mode === "blur" ? "blur" : "hide";
      $("modeHide").checked = s.mode !== "blur";
      $("modeBlur").checked = s.mode === "blur";
      $("hiddenTotal").textContent = (o.stats && o.stats.hiddenTotal) || 0;
      setStatus(!!s.enabled);
      const learnedMap = o.learned || {};
      const setCount = (id, n) => { const el = $(id); if (el) el.textContent = n; };
      setCount("learnedCount", Object.keys(learnedMap).length);
      setCount("blockedCount", renderList($("blockedList"), o.blocked || {}, false, "blocked"));
      setCount("learnedListCount", renderList($("learnedList"), learnedMap, true, "learned"));
      setCount("allowedCount", renderList($("allowedList"), o.allowed || {}, false, "allowed"));
    } catch (e) {}
  }

  function bindToggle(id, key) {
    $(id).addEventListener("change", (e) => {
      if (id === "tEnabled") setStatus(e.target.checked);
      writeSettings({ [key]: e.target.checked }).catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindToggle("tEnabled", "enabled");
    bindToggle("tStrict", "strict");
    bindToggle("tShortsAi", "shortsAi");
    bindToggle("tSkipShorts", "skipShorts");
    // Segmented control: radio input sets the hidden backing select; the select
    // (which the storage save code listens to) fires a programmatic change.
    const mode = $("mode");
    for (const radio of [$("modeHide"), $("modeBlur")]) {
      radio.addEventListener("change", () => {
        if (radio.checked && mode.value !== radio.value) {
          mode.value = radio.value;
          mode.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }
    mode.addEventListener("change", (e) => {
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
