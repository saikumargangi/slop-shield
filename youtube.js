// Slop Shield v0.1 — YouTube content script.
// Detects AI-slop tiles, hides/blurs them, learns channels. Never flags "Auto-dubbed".
(function () {
  "use strict";

  const SS = window.SlopShield;

  const TILE_SEL =
    "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, " +
    "yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer";

  // Fetched pages are judged by detect.js (spoof-resistant, any UI language).
  // On the live watch page we trust YouTube's rendered section and its help link.
  const AI_HELP_ID = "15447836";
  const AI_LABEL_TEXT_RE = /altered or fully generated/i;
  const LEARN_THRESHOLD = 2; // distinct labelled videos before a whole channel is hidden
  const DAILY_MAX = 200;     // page fetches per day, per browser
  const DWELL_MS = 1000;     // a tile must stay on screen this long before we fetch
  const CHANNEL_ID_RE = /"channelId":"(UC[\w-]{22})"/;
  const STRICT_TITLE_RE = /\b(ai[- ]generated|made with ai|#aiart|ai art|ai animation|ai video)\b/i;
  // Shorts title rule, tuned on tests/eval.py: must say the video was MADE with AI
  // (hashtags, "AI cat", "made with Sora"), and must not read as news/tutorials ABOUT AI.
  // v0.2's /\bai\b/ hid 15/37 AI-news Shorts; this hides 0 of them and keeps ~90% of real slop.
  const SHORTS_MADE_WITH_AI_RE = /(#ai\w*|#sora\w*|#veo\w*|#midjourney|\bsora\b|\bai[\s-]+(cute\s+)?(generated|video|videos|art|animation|animated|cat|cats|dog|dogs|animal|animals|baby|babies|kitten|puppy|story|music|song|songs|film|movie|short|shorts|moments)\b|\bmade (with|by|using) (ai|sora|veo)\b|\bgenerated (with|by|using) ai\b|\b(video|song|film|art) with ai\b)/i;
  const ABOUT_AI_RE = /\b(news|ceos?|unsc|law|legislation|this week|updates?|anthropic|zuckerberg|gates|risks?|regulat\w*|policy|world leaders|explained|how to|tutorial|for free|refuse)\b/i;
  const VIDEO_ID_RE = /(?:v=|shorts\/)([\w-]{11})/;

  const MAX_CHECKS_PER_LOAD = 60;
  const CHECK_GAP_MS = 400;

  let settings = { ...SS.DEFAULT_SETTINGS };
  let blocked = {};
  let learned = {};
  let verdicts = {};
  let allowed = {}; // user said "not AI": channel keys and video ids

  // Why a tile gets hidden (shown on the blur overlay). null = keep.
  function channelReason(ch, tile) {
    if (!ch || allowed[ch.key]) return null;
    if (blocked[ch.key]) return "You blocked this channel";
    const l = learned[ch.key];
    // Verified channels (news outlets, artists) are never hidden wholesale: one AI segment
    // on Times of India must not bury the channel. Their labelled videos still hide one by one.
    if (l && (l.count || 0) >= LEARN_THRESHOLD && !isVerified(tile)) return "Channel has " + l.count + " YouTube-labelled AI videos";
    return null;
  }

  // Any badge beside the channel name is a verified/official badge (label text is localized).
  function isVerified(tile) {
    return !!(tile && tile.querySelector('[aria-label="Verified"], ytd-channel-name ytd-badge-supported-renderer .badge, ytd-channel-name .ytBadgeShapeHost'));
  }

  let io = null;
  let bodyObserver = null;
  let scanTimer = null;

  let queue = [];
  let pumpTimer = null;
  let fetching = false;
  let lastFetchAt = 0;
  let checksThisLoad = 0;
  let halted = false; // any non-200/error stops the queue for this page load
  let watchLearnedFor = null;

  // ---------- data ----------
  async function loadAll() {
    settings = await SS.getSettings();
    // storage is treated as untrusted too: anything not a plain object resets
    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    blocked = obj(await SS.get("blocked", {}));
    learned = obj(await SS.get("learned", {}));
    verdicts = obj(await SS.get("verdicts", {}));
    allowed = obj(await SS.get("allowed", {}));
  }

  // ---------- tile parsing ----------
  function videoIdOf(tile) {
    const a = tile.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!a) return null;
    const m = (a.getAttribute("href") || "").match(VIDEO_ID_RE);
    return m ? m[1] : null;
  }

  function channelKeyOf(href) {
    try {
      return new URL(href, location.origin).pathname || href;
    } catch (e) {
      return href;
    }
  }

  function channelOf(tile) {
    let a = tile.querySelector('a[href^="/@"]');
    if (!a) a = tile.querySelector('a[href^="/channel/"]');
    if (!a) return null; // shorts tiles often have no channel link
    const key = channelKeyOf(a.getAttribute("href") || "");
    if (!key || key === "/") return null;
    return { key, name: (a.textContent || "").trim() || key };
  }

  function titleOf(tile) {
    // Priority order matters: a comma selector returns the first match in DOM order,
    // which on Shorts is the empty thumbnail link.
    for (const sel of ["#video-title", "h3"]) {
      const t = (tile.querySelector(sel)?.textContent || "").trim();
      if (t) return t;
    }
    const a = tile.querySelector("a[aria-label]");
    return a ? a.getAttribute("aria-label").trim() : "";
  }

  // ---------- scan ----------
  function unhideAll() {
    try {
      for (const tile of document.querySelectorAll(TILE_SEL)) SS.resetTile(tile);
      for (const shelf of document.querySelectorAll("grid-shelf-view-model.ss-hidden")) shelf.classList.remove("ss-hidden");
    } catch (e) {}
  }

  function scan() {
    try {
      if (!settings.enabled || !settings.youtube) {
        if (document.querySelector('[data-ss="1"]')) unhideAll();
        return;
      }
      for (const tile of document.querySelectorAll(TILE_SEL)) {
        try { processTile(tile); } catch (e) {} // a DOM change must never throw
      }
      checkWatchPage();
      checkShortsPlayer();
      syncShelves();
    } catch (e) {}
  }

  // A Shorts shelf whose every Short is hidden goes too, header included.
  // (JS because CSS can't nest :has().)
  function syncShelves() {
    for (const shelf of document.querySelectorAll("grid-shelf-view-model")) {
      const cells = shelf.querySelectorAll(".ytGridShelfViewModelGridShelfItem");
      const allHidden = cells.length > 0 && [...cells].every((c) => c.querySelector(".ss-hidden"));
      shelf.classList.toggle("ss-hidden", allHidden);
    }
  }

  function processTile(tile) {
    if (tile.parentElement && tile.parentElement.closest(TILE_SEL)) return; // outermost tile wins

    const id = videoIdOf(tile);
    const ch = channelOf(tile);

    if (tile.dataset.ss === "1") {
      if ((tile.dataset.ssVid || "") === (id || "")) {
        // already decided; still catch channels learned/blocked since (siblings of a new AI verdict)
        if (ch) SS.attachBlockButton(tile, ch.key, ch.name);
        const r = channelReason(ch, tile);
        if (r && !(id && allowed[id])) SS.hideTile(tile, settings.mode, r, ch && ch.key, id);
        return;
      }
      SS.resetTile(tile); // YouTube recycles elements: video changed
      try { delete tile.dataset.ssCounted; } catch (e) {}
    }
    try { tile.dataset.ss = "1"; tile.dataset.ssVid = id || ""; } catch (e) { return; }

    if (ch) SS.attachBlockButton(tile, ch.key, ch.name);

    if ((id && allowed[id]) || (ch && allowed[ch.key])) return; // user said "not AI"
    const hide = (why) => SS.hideTile(tile, settings.mode, why, ch && ch.key, id);

    // 1. channel already known (manually blocked, or 2+ labelled videos)
    const r = channelReason(ch, tile);
    if (r) { hide(r); return; }

    // 2. cached verdict for this video
    if (id && verdicts[id]) {
      if (verdicts[id].ai) hide("YouTube label: Made with AI");
      return;
    }

    // 3. otherwise queue a label check — only for tiles in/near the viewport
    if (id && io) io.observe(tile);

    const isShort = tile.tagName === "YTM-SHORTS-LOCKUP-VIEW-MODEL" || tile.tagName === "YTD-REEL-ITEM-RENDERER" ||
      !!tile.querySelector('a[href*="/shorts/"]');
    const t = titleOf(tile);
    if (settings.shortsAi && isShort && SHORTS_MADE_WITH_AI_RE.test(t) && !ABOUT_AI_RE.test(t)) hide("Short's title says it's made with AI");

    // 4. strict keywords only (default off: wrongly hides AI news/reviews)
    if (settings.strict && STRICT_TITLE_RE.test(titleOf(tile))) hide("Title keyword (strict mode)");
  }

  // ---------- viewport-gated queue ----------
  function makeIO() {
    return new IntersectionObserver((entries) => {
      for (const entry of entries) {
        try {
          if (!entry.isIntersecting) continue;
          const tile = entry.target;
          io.unobserve(tile);
          if (!settings.enabled || !settings.youtube) continue;
          const id = videoIdOf(tile);
          if (!id) continue;
          const v = verdicts[id];
          if (v) {
            if (v.ai) SS.hideTile(tile, settings.mode, "YouTube label: Made with AI", null, id);
            continue;
          }
          // dwell: only fetch for tiles the user actually looks at
          setTimeout(() => {
            try {
              if (!tile.isConnected || videoIdOf(tile) !== id) return;
              const b = tile.getBoundingClientRect();
              if (b.bottom > 0 && b.top < innerHeight && b.width > 0) enqueueCheck(tile, id);
              else io.observe(tile); // scrolled away: wait for it to come back
            } catch (e) {}
          }, DWELL_MS);
        } catch (e) {}
      }
    }, { rootMargin: "200px" });
  }

  function enqueueCheck(tile, id) {
    if (queue.some((j) => j.id === id)) return;
    queue.push({ tile, id, ch: channelOf(tile) }); // capture now: the tile may be recycled before the fetch returns
    pump();
  }

  // ---------- Shorts player: auto-skip Shorts YouTube labels "Made with AI" ----------
  // The swipe feed has no tiles to hide, so we move to the next Short instead.
  let lastShortId = null;
  function checkShortsPlayer() {
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    if (!m || !settings.enabled || !settings.youtube || !settings.skipShorts) return;
    const id = m[1];
    if (id === lastShortId) return;
    lastShortId = id;
    if (allowed[id]) return;
    const act = (ai) => { if (ai && location.pathname.includes(id)) skipShort(id); };
    if (verdicts[id]) return act(verdicts[id].ai);
    if (!queue.some((j) => j.id === id)) queue.unshift({ tile: null, id, ch: null, onDone: act }); // jump the queue
    pump();
  }

  function skipShort(id) {
    const next = document.querySelector('#navigation-button-down button, button[aria-label="Next video"]');
    if (next) next.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    toast("Skipped an AI Short (YouTube label: Made with AI)", id);
  }

  function toast(text, id) {
    try {
      document.querySelector(".ss-toast")?.remove();
      const t = document.createElement("div");
      t.className = "ss-toast";
      t.textContent = text + " ";
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "Not AI? Go back";
      back.addEventListener("click", () => { SS.allow([id]); history.back(); t.remove(); });
      t.appendChild(back);
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 6000);
    } catch (e) {}
  }

  function pump() {
    if (fetching || halted || !queue.length) return;
    if (checksThisLoad >= MAX_CHECKS_PER_LOAD) { queue = []; return; }
    if (pumpTimer) return;
    const wait = Math.max(0, CHECK_GAP_MS - (Date.now() - lastFetchAt)); // >= 400 ms apart
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      runCheck();
    }, wait);
  }

  async function runCheck() {
    if (fetching || halted || !queue.length) return;
    if (!settings.enabled || !settings.youtube) { queue = []; return; }
    if (checksThisLoad >= MAX_CHECKS_PER_LOAD) { queue = []; return; }

    const job = queue.shift();
    fetching = true; // 1 request in flight
    lastFetchAt = Date.now();
    checksThisLoad += 1;
    try {
      if (!(await SS.takeDailyQuota(DAILY_MAX))) throw new Error("daily cap");
      const resp = await fetch("https://www.youtube.com/watch?v=" + job.id, { credentials: "include" });
      if (!resp || resp.status !== 200) throw new Error("non-200");
      // YouTube bot check / consent wall: stop immediately, never retry around it
      if (/\/sorry\/|consent\./.test(resp.url)) throw new Error("challenge");
      const html = await resp.text();
      if (/unusual traffic|detected unusual/i.test(html.slice(0, 20000))) throw new Error("challenge");
      const ai = globalThis.ssDetect.isAiLabelled(html);
      const m = html.match(CHANNEL_ID_RE);
      const rec = { ai: ai, ch: null, chId: m ? m[1] : null, at: Date.now() };
      const ch = job.ch;
      if (ch) rec.ch = ch.key;
      verdicts[job.id] = rec;
      await SS.recordVerdict(job.id, rec);
      if (ai) {
        if (ch) learned = await SS.addLearned(ch.key, ch.name, job.id);
        if (job.tile && job.tile.isConnected && videoIdOf(job.tile) === job.id)
          SS.hideTile(job.tile, settings.mode, "YouTube label: Made with AI", ch && ch.key, job.id);
        scheduleScan(); // pick up sibling tiles from the same channel
      }
      if (job.onDone) job.onDone(ai);
    } catch (e) {
      halted = true; // stop the queue for this page load
      queue = [];
    } finally {
      fetching = false;
      pump();
    }
  }

  // ---------- watch page: learn the owner's channel, never hide the watched video ----------
  function checkWatchPage() {
    try {
      if (location.pathname !== "/watch") return;
      const sec = document.querySelector(
        "how-this-was-made-section-view-model, ytd-how-this-was-made-section-view-model"
      );
      // YouTube's own component (not creator text); link id works in every UI language
      if (!sec || !(sec.querySelector('a[href*="' + AI_HELP_ID + '"]') || AI_LABEL_TEXT_RE.test(sec.textContent || ""))) return;
      const id = new URLSearchParams(location.search).get("v") || location.pathname;
      if (watchLearnedFor === id) return; // count once per video
      const a = document.querySelector('ytd-video-owner-renderer a[href^="/@"]');
      if (!a) return;
      const key = channelKeyOf(a.getAttribute("href") || "");
      if (!key || key === "/") return;
      watchLearnedFor = id;
      const name = (a.textContent || "").trim() || key;
      SS.addLearned(key, name, id).then((m) => { learned = m; }).catch(() => {});
    } catch (e) {}
  }

  // ---------- observers ----------
  function scheduleScan() {
    // Throttle, not debounce: YouTube mutates the DOM nonstop, and a resetting
    // debounce would postpone the scan forever.
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  function startObservers() {
    try {
      bodyObserver = new MutationObserver(scheduleScan);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    try {
      window.addEventListener("yt-navigate-finish", () => {
        checksThisLoad = 0; // new page load: fresh quota
        halted = false;
        queue = [];
        watchLearnedFor = null;
        scheduleScan();
      });
    } catch (e) {}
  }

  // Setting/list changes re-apply without a reload.
  SS.onStorageChanged(async (changes) => {
    await loadAll();
    if (changes.settings || changes.blocked || changes.allowed) unhideAll(); // lists shrank or mode changed: re-decide everything
    scan();
  });

  (async function init() {
    try {
      await loadAll();
      io = makeIO();
      scan();
      startObservers();
      setInterval(() => { try { checkShortsPlayer(); } catch (e) {} }, 700);
    } catch (e) {}
  })();
})();
