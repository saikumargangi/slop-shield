// Run: node tests/test_detect.js  (real YouTube pages saved 2026-09-26 + crafted spoofs)
const fs = require("fs"), path = require("path"), assert = require("assert");
require("../detect.js");
const { isAiLabelled, AI_HELP } = globalThis.ssDetect;
const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");

const dubbed = fx("pNMMFov2f_c.en.html");
const cases = [
  ["AI-labelled video (English)", fx("zBeVak5fD9o.en.html"), true],
  ["AI-labelled video (Spanish UI: 'Creado con IA')", fx("zBeVak5fD9o.es.html"), true],
  ["auto-dubbed only", dubbed, false],
  ["plain video", fx("Uc8y94QhZ6E.en.html"), false],
  // Creator types the label text + help link in their description (arrives JSON-escaped in ytInitialData)
  ["spoof: phrase + help link in description",
    dubbed.replace('"attributedDescription":{"content":"', '"attributedDescription":{"content":"Sounds or visuals were altered or fully generated. ' + AI_HELP + ' '), false],
  // Creator types the literal section key in their description: quotes are escaped as \" in the JSON
  ["spoof: escaped fake section in description",
    dubbed.replace('"attributedDescription":{"content":"', '"attributedDescription":{"content":"\\"howThisWasMadeSectionViewModel\\":{\\"x\\":\\"' + AI_HELP + '\\"} '), false],
  // Creator puts the raw fake key in the video title: appears unescaped in <title>, before ytInitialData
  ["spoof: raw fake section in <title>",
    dubbed.replace("<title>", '<title>"howThisWasMadeSectionViewModel":{"x":"' + AI_HELP + '"}'), false],
  // YouTube's other page format; guard against the parser skipping it
  ["AI label in <script id=yt-initial-data> format", fx("zBeVak5fD9o.en.html"), true],
  ["no ytInitialData at all", '<html>"howThisWasMadeSectionViewModel":{"a":"' + AI_HELP + '"}</html>', false],
  // page cut off in the middle of YouTube's section object: must not count as labelled
  ["truncated/malformed page", (h => h.slice(0, h.indexOf('"howThisWasMadeSectionViewModel"') + 120))(fx("zBeVak5fD9o.en.html")), false],
];
let failed = 0;
for (const [name, html, want] of cases) {
  const got = isAiLabelled(html);
  console.log(`${got === want ? "ok  " : "FAIL"}  ${name}: ${got}`);
  if (got !== want) failed++;
}
// the spoof tests must actually contain the spoof text (guard against a no-op replace)
assert(cases[4][1].includes("altered or fully generated. " + AI_HELP));
assert(cases[5][1].includes('\\"howThisWasMadeSectionViewModel\\"'));
assert(cases[6][1].includes('<title>"howThisWasMadeSectionViewModel"'));
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
