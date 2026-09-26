> Original v0.1 build spec. Etsy support was removed in 1.0 (no reliable AI signal on Etsy).

# Slop Shield v1: Chrome extension (Manifest V3)

Hides AI-generated "slop" on YouTube (main) and Etsy (beta). No backend, no analytics,
no remote code. The only network requests are to youtube.com. Plain JS, no build step, no dependencies.

## Files (keep it this small)
- `manifest.json`: MV3, name "Slop Shield", version 0.1.0, permissions `["storage"]`,
  host_permissions `https://www.youtube.com/*`, `https://www.etsy.com/*`.
  content_scripts: youtube.js + styles.css on `https://www.youtube.com/*`;
  etsy.js + styles.css on `https://www.etsy.com/*`; `common.js` loaded first in both. action → popup.html.
- `common.js`: settings and storage helpers (chrome.storage.local only), hide/blur helpers, the hover "block" button.
- `youtube.js`, `etsy.js`, `styles.css`, `popup.html`, `popup.js`.

## Settings (chrome.storage.local, key `settings`)
`{enabled:true, youtube:true, etsy:true, mode:"hide"|"blur" (default "hide"), strict:false}`
Other keys: `blocked` {channelOrShopKey: {name, at}}, `learned` {channelKey: {name, count, at}},
`verdicts` {videoId: {ai:bool, ch:channelKey, at}} (cap 5000; when over the cap, drop the oldest 1000),
`stats` {hiddenTotal:int}.

## YouTube detection (verified against the live site on 2026-09-26)
Tile elements: `ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer,
yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer`.
- Video ID comes from the first `a[href*="/watch?v="]` or `a[href*="/shorts/"]` inside the tile.
- Channel key is the first `a[href^="/@"]` href (e.g. `/@Ai-Chemy`) or `a[href^="/channel/"]`. Channel name is that link's text.
  Shorts tiles often have no channel link. Then rely on the video verdict only.

Decide per tile, in this order:
1. The channel is in `blocked` or `learned` → slop.
2. A cached verdict for the video ID exists → use it.
3. Otherwise queue a label check: `fetch("https://www.youtube.com/watch?v="+id, {credentials:"include"})`,
   then `text()`. The video is AI if the HTML matches `/altered or fully generated/i`.
   **Never** treat "Auto-dubbed" or the mere presence of a "How this was made" section as AI.
   Auto-dubbed videos also have that section, and that false positive is the #1 complaint about competing extensions.
   Also extract `"channelId":"(UC[\w-]{22})"` for the record. Cache the verdict.
   If AI and the tile has a channel key, add it to `learned` (count += 1).
   Queue: 1 request in flight, at least 400 ms apart, at most 60 checks per page load, only for tiles
   in or near the viewport (IntersectionObserver). On any non-200 status or error, stop the queue for that page load.
4. `strict` mode only: the title matches `/\b(ai[- ]generated|made with ai|#aiart|ai art|ai animation|ai video)\b/i` → slop.
   Default off: keyword matching wrongly hides AI news and review videos (e.g. "Sora 2 vs Veo 3 Comparison").

On a watch page (`/watch`): if `how-this-was-made-section-view-model` textContent matches
`/altered or fully generated/i`, learn the owner's channel (from `ytd-video-owner-renderer a[href^="/@"]`).
Do not hide the video the user is watching.

Rescan on DOM changes (MutationObserver on document.body, debounced 300 ms) and on the `yt-navigate-finish` event.
Mark processed tiles with `data-ss="1"` so they aren't reprocessed. Clear the mark if the tile's video ID changes, because YouTube recycles elements.

## Etsy (beta)
Cards are `[data-listing-id]`. Title from the `h3` inside the card. Shop name from the `[data-shop-name]` attribute or text if present.
- Slop if the shop is in `blocked`, or the title matches
  `/\b(ai[- ]generated|ai art|midjourney|stable diffusion|ai clipart|ai image|ai-created)\b/i` (always on for Etsy).
- Same observer and mark approach.

## Hiding
- mode "hide": add class `ss-hidden` (display:none !important).
- mode "blur": add class `ss-blur` (filter: blur(12px); pointer-events none on children) plus an overlay
  "Made with AI · Show" button that removes the blur for that tile only.
- Each tile gets a small hover button (top-right, `🚫`, title "Block this channel/shop") that adds the key to `blocked` and hides the tile immediately.
- Increment `stats.hiddenTotal` once per tile hidden.
- Setting changes (storage.onChanged) re-apply without a reload.

## Popup (popup.html/js, about 300px wide, clean, readable)
Toggles: Enabled, YouTube, Etsy, Strict keywords. Mode select (Hide / Blur).
"Hidden so far: N". Two lists with a remove (×) button each: Blocked (manual), Learned AI channels (with count).
Footer: "Slop Shield v0.1 · runs locally, nothing leaves your browser".

## Rules
- No external libraries, no eval, no remote scripts (Chrome Web Store policy).
- Everything wrapped so a YouTube DOM change can't throw uncaught errors (try/catch per tile).
- Don't create test files. The reviewer writes the tests.
