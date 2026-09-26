// Slop Shield: YouTube AI-label detection from watch-page HTML.
// Spoof-resistant and language-independent: we only trust YouTube's own
// "How this was made" section object, and inside it only the link to the
// AI-disclosure help article. Creator-written text (titles, descriptions,
// comments) is JSON-escaped in the page, so it can't forge the unescaped key.
(function (root) {
  "use strict";

  const SECTION_KEY = '"howThisWasMadeSectionViewModel":{';
  const AI_HELP = "support.google.com/youtube/answer/15447836"; // "Made with AI" (auto-dub is 15569972)

  // Returns the JSON object text starting at html[start] === "{", honouring strings/escapes.
  function objectAt(html, start) {
    let depth = 0, inStr = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return html.slice(start, i + 1);
    }
    return "";
  }

  function isAiLabelled(html) {
    // Only YouTube's data payload counts. Raw page text like <title> carries
    // creator-typed strings unescaped, so we skip everything before it.
    // YouTube A/B-tests two formats: `var ytInitialData = {...}` and
    // `<script id="yt-initial-data" type="application/json">{...}`.
    const marks = [html.indexOf("ytInitialData"), html.indexOf('id="yt-initial-data"')].filter((i) => i >= 0);
    if (!marks.length) return false;
    let from = Math.min(...marks);
    for (;;) {
      const at = html.indexOf(SECTION_KEY, from);
      if (at < 0) return false;
      from = at + SECTION_KEY.length;
      if (html[at - 1] === "\\") continue; // escaped = inside user text, not YouTube's structure
      if (objectAt(html, from - 1).includes(AI_HELP)) return true;
    }
  }

  root.ssDetect = { isAiLabelled, AI_HELP };
})(typeof globalThis !== "undefined" ? globalThis : this);
