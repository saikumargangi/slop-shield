// Slop Shield v0.1 — Etsy content script (beta).
// Shop-blocklist + always-on title keywords. No network requests.
(function () {
  "use strict";

  const SS = window.SlopShield;

  const CARD_SEL = "[data-listing-id]";
  // Always on for Etsy.
  const KEYWORD_RE = /\b(ai[- ]generated|ai art|midjourney|stable diffusion|ai clipart|ai image|ai-created)\b/i;

  let settings = { ...SS.DEFAULT_SETTINGS };
  let blocked = {};
  let bodyObserver = null;
  let scanTimer = null;

  async function loadAll() {
    settings = await SS.getSettings();
    blocked = (await SS.get("blocked", {})) || {};
  }

  function titleOf(card) {
    const h = card.querySelector("h3");
    return h ? (h.textContent || "").trim() : "";
  }

  function shopOf(card) {
    let el = null;
    try {
      el = card.matches("[data-shop-name]") ? card : card.querySelector("[data-shop-name]");
    } catch (e) {}
    if (!el) return null;
    const name = (el.getAttribute("data-shop-name") || (el.textContent || "")).trim();
    if (!name) return null;
    return { key: name, name: name };
  }

  function unhideAll() {
    try {
      for (const card of document.querySelectorAll(CARD_SEL)) SS.resetTile(card);
    } catch (e) {}
  }

  function scan() {
    try {
      if (!settings.enabled || !settings.etsy) {
        if (document.querySelector('[data-ss="1"]')) unhideAll();
        return;
      }
      for (const card of document.querySelectorAll(CARD_SEL)) {
        try { processCard(card); } catch (e) {}
      }
    } catch (e) {}
  }

  function processCard(card) {
    if (card.parentElement && card.parentElement.closest(CARD_SEL)) return; // outermost card wins

    const id = card.getAttribute("data-listing-id") || "";
    if (card.dataset.ss === "1") {
      if ((card.dataset.ssVid || "") === id) return; // already decided for this listing
      SS.resetTile(card);
      try { delete card.dataset.ssCounted; } catch (e) {}
    }
    try { card.dataset.ss = "1"; card.dataset.ssVid = id; } catch (e) { return; }

    const shop = shopOf(card);
    if (shop) SS.attachBlockButton(card, shop.key, shop.name);

    if (shop && blocked[shop.key]) {
      SS.hideTile(card, settings.mode);
      return;
    }
    if (KEYWORD_RE.test(titleOf(card))) SS.hideTile(card, settings.mode);
  }

  function scheduleScan() {
    if (scanTimer) return; // throttle, not debounce: continuous mutations must not starve the scan
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  // Setting/list changes re-apply without a reload.
  SS.onStorageChanged(async () => {
    await loadAll();
    unhideAll();
    scan();
  });

  (async function init() {
    try {
      await loadAll();
      scan();
      bodyObserver = new MutationObserver(scheduleScan);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  })();
})();
