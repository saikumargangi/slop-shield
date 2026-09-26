"""Extensive eval: browse many real YouTube searches with the extension, record every hide.

Normal topics measure false positives; AI topics measure recall.
Run: .venv/bin/python tests/eval.py   -> tests/eval_results.json + shots/eval_*.png
"""
import hashlib, json, os, sys, tempfile
from playwright.sync_api import sync_playwright

EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(EXT, "tests", "eval_results.json")
NORMAL = ["pasta recipe", "world news today", "lofi music", "minecraft let's play", "kids nursery rhymes",
          "cricket highlights", "mit lecture calculus", "hindi news", "telugu movie songs", "car review 2026",
          "cat videos funny real", "ai news this week"]  # last one: AI *topic*, not AI-made
AI = ["ai generated cat video", "sora 2 videos", "ai animals shorts", "ai generated music video"]
TILES = "ytd-video-renderer, ytm-shorts-lockup-view-model, ytd-rich-item-renderer, yt-lockup-view-model"


def ext_id(path):
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])


def run(page, q):
    page.goto("https://www.youtube.com/results?search_query=" + q.replace(" ", "+"))
    page.wait_for_timeout(3500)
    for _ in range(4):
        page.mouse.wheel(0, 1400); page.wait_for_timeout(1800)
    page.mouse.wheel(0, -20000); page.wait_for_timeout(1500)
    for _ in range(4):  # let the 1s-dwell + 400ms queue finish for the top of the page
        page.mouse.wheel(0, 700); page.wait_for_timeout(2500)
    return page.evaluate("""(sel) => {
      const tiles = [...document.querySelectorAll(sel)].filter(t => !t.parentElement.closest(sel));
      const title = t => (t.querySelector('#video-title, h3')?.textContent || '').trim().slice(0, 90);
      const chan = t => (t.querySelector('a[href^="/@"]')?.getAttribute('href') || '');
      const hidden = tiles.filter(t => t.classList.contains('ss-blur') || t.classList.contains('ss-hidden'));
      return {total: tiles.length,
              hidden: hidden.map(t => ({title: title(t), channel: chan(t), reason: t.dataset.ssReason || '',
                                        short: t.tagName.includes('SHORTS')}))};
    }""", TILES)


def main():
    results = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(), channel="chromium", headless=True, locale="en-US",
            viewport={"width": 1400, "height": 1000},
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        pop = ctx.new_page()
        pop.goto(f"chrome-extension://{ext_id(EXT)}/popup.html")
        # blur mode so hidden tiles keep their title for the record
        pop.evaluate("() => chrome.storage.local.set({settings: {enabled: true, youtube: true, mode: 'blur', strict: false, shortsAi: true}})")
        page = ctx.new_page()
        for kind, qs in (("normal", NORMAL), ("ai", AI)):
            for q in qs:
                r = run(page, q)
                r["kind"] = kind
                results[q] = r
                page.screenshot(path=os.path.join(EXT, "shots", f"eval_{q.replace(' ', '_')}.png"))
                print(f"{kind:6} {q:28} hidden {len(r['hidden']):3}/{r['total']:3}")
        quota = pop.evaluate("() => chrome.storage.local.get('quota').then(o => o.quota)")
        ctx.close()
    json.dump(results, open(OUT, "w"), indent=1, ensure_ascii=False)
    n_hid = sum(len(r["hidden"]) for r in results.values() if r["kind"] == "normal")
    n_tot = sum(r["total"] for r in results.values() if r["kind"] == "normal")
    a_hid = sum(len(r["hidden"]) for r in results.values() if r["kind"] == "ai")
    a_tot = sum(r["total"] for r in results.values() if r["kind"] == "ai")
    print(f"\nnormal topics: {n_hid}/{n_tot} hidden ({100*n_hid/max(n_tot,1):.1f}%) <- every one needs a human look")
    print(f"AI topics:     {a_hid}/{a_tot} hidden ({100*a_hid/max(a_tot,1):.1f}%)")
    print("quota used:", quota)


if __name__ == "__main__":
    main()
