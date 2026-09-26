// Slop Shield v0.1 — shared helpers: settings/storage, hide/blur, hover block button.
// Loaded first on both YouTube and Etsy. chrome.storage.local only. No network, no libraries.
(function () {
  "use strict";

  const DEFAULT_SETTINGS = { enabled: true, youtube: true, etsy: true, mode: "hide", strict: false, shortsAi: true, skipShorts: true };
  const VERDICT_CAP = 5000;  // max cached verdicts
  const VERDICT_DROP = 1000; // dropped (oldest first) when the cap is exceeded

  let cachedSettings = { ...DEFAULT_SETTINGS };

  // ---------- storage ----------
  function get(key, fallback = null) {
    try {
      return chrome.storage.local.get(key).then((o) => (o && o[key] !== undefined ? o[key] : fallback));
    } catch (e) {
      return Promise.resolve(fallback);
    }
  }

  function set(key, value) {
    try {
      return chrome.storage.local.set({ [key]: value });
    } catch (e) {
      return Promise.resolve();
    }
  }

  async function update(key, fn, fallback) {
    const cur = await get(key, fallback);
    let next = cur;
    try { next = fn(cur); } catch (e) { next = cur; }
    await set(key, next);
    return next;
  }

  async function getSettings() {
    const s = await get("settings", null);
    cachedSettings = { ...DEFAULT_SETTINGS, ...(s || {}) };
    return cachedSettings;
  }

  async function saveSettings(patch) {
    await getSettings();
    cachedSettings = { ...cachedSettings, ...patch };
    await set("settings", cachedSettings);
    return cachedSettings;
  }

  // ---------- blocked / learned / verdicts ----------
  async function addBlocked(key, name) {
    if (!key) return;
    await update("blocked", (m) => {
      m = m || {};
      if (!m[key]) m[key] = { name: name || key, at: Date.now() };
      return m;
    }, {});
  }

  // count = DISTINCT labelled videos, so seeing one video twice never counts twice
  async function addLearned(key, name, videoId) {
    if (!key) return get("learned", {});
    return update("learned", (m) => {
      m = m || {};
      const prev = m[key] || { name: name || key, vids: [], at: 0 };
      const vids = Array.isArray(prev.vids) ? prev.vids.slice(-19) : [];
      if (videoId && !vids.includes(videoId)) vids.push(videoId);
      m[key] = { name: prev.name || name || key, vids, count: vids.length, at: Date.now() };
      return m;
    }, {});
  }

  async function takeDailyQuota(max) {
    const day = new Date().toISOString().slice(0, 10);
    let ok = false;
    await update("quota", (q) => {
      q = q && q.day === day ? q : { day, n: 0 };
      if (q.n < max) { q.n++; ok = true; }
      return q;
    }, null);
    return ok;
  }

  async function allow(keys) {
    await update("allowed", (m) => {
      m = m || {};
      for (const k of keys) if (k) m[k] = { at: Date.now() };
      return m;
    }, {});
  }

  async function removeFrom(store, key) {
    await update(store, (m) => { if (m) delete m[key]; return m; }, {});
  }

  async function recordVerdict(videoId, rec) {
    if (!videoId) return;
    await update("verdicts", (m) => {
      m = m || {};
      m[videoId] = rec;
      const keys = Object.keys(m);
      if (keys.length > VERDICT_CAP) {
        keys.sort((a, b) => (m[a].at || 0) - (m[b].at || 0));
        for (let i = 0; i < VERDICT_DROP; i++) delete m[keys[i]];
      }
      return m;
    }, {});
  }

  // ---------- stats ----------
  let pendingHidden = 0;
  let statChain = Promise.resolve();
  function addHiddenTotal(n) {
    try {
      pendingHidden += n;
      statChain = statChain.then(async () => {
        if (pendingHidden <= 0) return;
        const add = pendingHidden;
        pendingHidden = 0;
        await update("stats", (s) => {
          s = s || {};
          s.hiddenTotal = (s.hiddenTotal || 0) + add;
          return s;
        }, { hiddenTotal: 0 });
      });
      statChain = statChain.catch(() => {});
    } catch (e) {}
    return statChain;
  }

  // ---------- hide / blur ----------
  function currentMode() {
    return cachedSettings && cachedSettings.mode === "blur" ? "blur" : "hide";
  }

  function hideTile(tile, mode, reason, channelKey, videoId) {
    if (!tile) return;
    try {
      tile.classList.add("ss-host");
      if (reason) tile.dataset.ssReason = reason;
      if (tile.dataset.ssRevealed === "1") return; // user pressed "Show" on this tile
      const m = mode || currentMode();
      if (m === "blur") {
        tile.classList.remove("ss-hidden");
        tile.classList.add("ss-blur");
        if (!tile.querySelector(":scope > .ss-show")) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ss-show";
          btn.textContent = (tile.dataset.ssReason || "Hidden by Slop Shield") + " · Show";
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              tile.classList.remove("ss-blur");
              tile.dataset.ssRevealed = "1";
              btn.remove();
              notAi.remove();
            } catch (e) {}
          });
          // "Not AI": remember it so this video/channel is never hidden again
          const notAi = document.createElement("button");
          notAi.type = "button";
          notAi.className = "ss-notai";
          notAi.textContent = "Not AI";
          notAi.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            allow([videoId, channelKey]);
          });
          tile.append(btn, notAi);
        }
      } else {
        tile.classList.remove("ss-blur");
        tile.classList.add("ss-hidden");
        for (const b of tile.querySelectorAll(":scope > .ss-show, :scope > .ss-notai")) b.remove();
      }
      if (tile.dataset.ssCounted !== "1") {
        tile.dataset.ssCounted = "1";
        addHiddenTotal(1); // once per tile
      }
    } catch (e) {}
  }

  function showTile(tile) {
    if (!tile) return;
    try {
      tile.classList.remove("ss-hidden", "ss-blur");
      for (const b of tile.querySelectorAll(":scope > .ss-show, :scope > .ss-notai")) b.remove();
    } catch (e) {}
  }

  // Clears processing marks so the next scan re-decides (settings/list edits, recycled elements).
  function resetTile(tile) {
    if (!tile) return;
    showTile(tile);
    try {
      delete tile.dataset.ss;
      delete tile.dataset.ssVid;
      delete tile.dataset.ssRevealed;
      delete tile.dataset.ssReason;
    } catch (e) {}
  }

  // ---------- hover block button ----------
  function attachBlockButton(tile, key, name) {
    if (!tile || !key) return;
    try {
      tile.classList.add("ss-host");
      const old = tile.querySelector(":scope > .ss-block");
      if (old) { old.dataset.key = key; old.dataset.name = name || key; return; } // recycled tile: retarget
      const btn = document.createElement("button");
      btn.dataset.key = key;
      btn.dataset.name = name || key;
      btn.type = "button";
      btn.className = "ss-block";
      btn.textContent = "\u{1F6AB}";
      btn.title = "Block this channel/shop";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        addBlocked(btn.dataset.key, btn.dataset.name);
        hideTile(tile); // hides immediately in the current mode
      });
      tile.appendChild(btn);
    } catch (e) {}
  }

  // ---------- settings change propagation ----------
  function onStorageChanged(cb) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (!(changes.settings || changes.blocked || changes.learned || changes.allowed)) return;
        getSettings()
          .then(() => { try { cb(changes); } catch (e) {} })
          .catch(() => {});
      });
    } catch (e) {}
  }

  window.SlopShield = {
    DEFAULT_SETTINGS,
    get,
    set,
    update,
    getSettings,
    saveSettings,
    addBlocked,
    addLearned,
    takeDailyQuota,
    allow,
    removeFrom,
    recordVerdict,
    addHiddenTotal,
    hideTile,
    showTile,
    resetTile,
    attachBlockButton,
    onStorageChanged,
    currentMode,
  };
})();
