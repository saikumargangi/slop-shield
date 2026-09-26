"""Real-browser check: load the unpacked extension, browse YouTube, assert what gets hidden.

Run: .venv/bin/python test_ui_browser.py   (screenshots land in shots/)
"""
import hashlib, os, re, sys, tempfile, time
from playwright.sync_api import sync_playwright

EXT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(EXT, "shots")
AI_LABELLED = "zBeVak5fD9o"      # carries "Made with AI" (verified 2026-09-26)
DUBBED_ONLY = "pNMMFov2f_c"      # carries "Auto-dubbed" only -> must stay visible


def ext_id(path):
    # Chrome derives an unpacked extension's ID from its absolute path.
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])


def tile_state(page, vid):
    return page.evaluate("""(vid) => {
      const a = document.querySelector(`a[href*="${vid}"]`);
      if (!a) return 'absent';
      const t = a.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer');
      if (!t) return 'no-tile';
      return t.classList.contains('ss-hidden') ? 'hidden' : t.classList.contains('ss-blur') ? 'blurred' : 'visible';
    }""", vid)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    failures = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(), channel="chromium", headless=True, locale="en-US",
            viewport={"width": 1400, "height": 1000},
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ss" in m.text.lower() else None)

        # 1. Popup renders
        page.goto(f"chrome-extension://{ext_id(EXT)}/popup.html")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOTS}/popup.png")
        if "Slop Shield" not in page.content():
            failures.append("popup: missing title")

        # 2. Search page: the AI-labelled video gets hidden, the dubbed-only one stays
        for q, must_hide, must_keep in [
            ("ai generated cat video", AI_LABELLED, None),
            ("ai generated video sora veo", None, DUBBED_ONLY),
        ]:
            page.goto("https://www.youtube.com/results?search_query=" + q.replace(" ", "+"))
            page.wait_for_timeout(4000)
            for _ in range(3):
                page.mouse.wheel(0, 1500); page.wait_for_timeout(1500)
            page.mouse.wheel(0, -10000)
            deadline = time.time() + 45
            while time.time() < deadline:
                if must_hide and tile_state(page, must_hide) in ("hidden", "blurred", "absent"):
                    break
                page.wait_for_timeout(2000)
            hidden = page.evaluate("document.querySelectorAll('.ss-hidden, .ss-blur').length")
            total = page.evaluate("document.querySelectorAll('ytd-video-renderer, ytm-shorts-lockup-view-model').length")
            print(f"[{q}] hidden {hidden}/{total}; target={must_hide and tile_state(page, must_hide)} keep={must_keep and tile_state(page, must_keep)}")
            page.screenshot(path=f"{SHOTS}/{q.replace(' ', '_')}.png")
            if must_hide and tile_state(page, must_hide) == "visible":
                failures.append(f"{must_hide} (Made with AI) still visible for '{q}'")
            if must_keep and tile_state(page, must_keep) in ("hidden", "blurred"):
                failures.append(f"{must_keep} (auto-dubbed only) wrongly hidden")
            if q == "ai generated cat video" and hidden == 0:
                failures.append("nothing hidden on an AI-heavy search page")
            holes = page.evaluate("""() => [...document.querySelectorAll('.ytGridShelfViewModelGridShelfItem')]
                .filter(c => c.querySelector('.ss-hidden') && getComputedStyle(c).display !== 'none').length""")
            # same rule the extension ships (read from youtube.js so the test can't drift)
            src = open(os.path.join(EXT, "youtube.js")).read()
            made = re.search(r"const SHORTS_MADE_WITH_AI_RE = /(.*)/i;", src).group(1)
            about = re.search(r"const ABOUT_AI_RE = /(.*)/i;", src).group(1)
            ai_shorts_left = page.evaluate("""([m, a]) => { const M = new RegExp(m, 'i'), A = new RegExp(a, 'i');
                return [...document.querySelectorAll('ytm-shorts-lockup-view-model')].filter(t => {
                  const h = (t.querySelector('h3')?.textContent || '');
                  return !t.closest('.ss-hidden') && M.test(h) && !A.test(h); }).length; }""", [made, about])
            empty_shelves = page.evaluate("""() => [...document.querySelectorAll('grid-shelf-view-model')]
                .filter(sh => getComputedStyle(sh).display !== 'none' && sh.querySelector('.ytGridShelfViewModelGridShelfItem')
                  && ![...sh.querySelectorAll('.ytGridShelfViewModelGridShelfItem')].some(c => getComputedStyle(c).display !== 'none')).length""")
            if empty_shelves:
                failures.append(f"{empty_shelves} empty Shorts shelf headers left")
            print(f"   shelf holes={holes} empty shelves={empty_shelves} visible AI-titled shorts={ai_shorts_left}")
            if ai_shorts_left:
                print("   debug:", page.evaluate(r"""() => [...document.querySelectorAll('ytm-shorts-lockup-view-model')]
                  .filter(t => !t.closest('.ss-hidden') && /\b(ai|sora|veo|midjourney)\b/i.test(t.textContent)).slice(0,4)
                  .map(t => ({ss: t.dataset.ss, outer: t.parentElement && t.parentElement.closest('ytd-video-renderer, ytd-rich-item-renderer, yt-lockup-view-model, ytd-reel-item-renderer')?.tagName,
                              h3: t.querySelector('h3')?.textContent.trim().slice(0,50), txt: t.textContent.replace(/\s+/g,' ').slice(0,70)}))"""))
            if holes:
                failures.append(f"{holes} empty Shorts slots left behind")
            if ai_shorts_left:
                failures.append(f"{ai_shorts_left} AI-titled Shorts still visible")

        # 3. Turning the extension off restores everything, shelves included
        pop0 = ctx.new_page(); pop0.goto(f"chrome-extension://{ext_id(EXT)}/popup.html")
        pop0.evaluate("() => chrome.storage.local.get('settings').then(o => chrome.storage.local.set({settings: {...(o.settings||{}), enabled: false}}))")
        page.wait_for_timeout(1500)
        still = page.evaluate("document.querySelectorAll('.ss-hidden, .ss-blur').length")
        print("hidden after disable:", still)
        if still:
            failures.append(f"{still} elements still hidden after disabling")
        pop0.evaluate("() => chrome.storage.local.get('settings').then(o => chrome.storage.local.set({settings: {...o.settings, enabled: true}}))")
        pop0.close()
        page.wait_for_timeout(1500)

        # 4. Recycled tile: the block button must block the tile's CURRENT channel
        page.evaluate("""() => {
            const t = document.createElement('ytd-video-renderer');
            t.id = 'ss-test';
            const a = document.createElement('a'); a.id = 'video-title'; a.href = '/watch?v=AAAAAAAAAAA'; a.textContent = 't';
            const c = document.createElement('a'); c.href = '/@chan-old'; c.textContent = 'old';
            t.append(a, c);
            document.querySelector('ytd-item-section-renderer, #contents, body').prepend(t);
        }""")
        page.wait_for_timeout(1500)
        page.evaluate("""() => { const t = document.getElementById('ss-test');
            const [a, c] = t.querySelectorAll('a');
            a.setAttribute('href', '/watch?v=BBBBBBBBBBB'); c.setAttribute('href', '/@chan-new'); c.textContent = 'new'; }""")
        page.wait_for_timeout(1500)
        page.evaluate("() => document.querySelector('#ss-test > .ss-block').click()")
        page.wait_for_timeout(800)
        pop = ctx.new_page()
        pop.goto(f"chrome-extension://{ext_id(EXT)}/popup.html")
        blocked = pop.evaluate("() => chrome.storage.local.get('blocked').then(o => Object.keys(o.blocked || {}))")
        pop.screenshot(path=f"{SHOTS}/popup_after.png")
        print("blocked after recycled-tile click:", blocked)
        if "/@chan-new" not in blocked or "/@chan-old" in blocked:
            failures.append(f"block button targeted stale channel: {blocked}")

        # 5. Blur mode shows WHY, and "Not AI" un-hides + remembers
        pop.evaluate("() => chrome.storage.local.get('settings').then(o => chrome.storage.local.set({settings: {...o.settings, mode: 'blur'}}))")
        page.goto("https://www.youtube.com/results?search_query=ai+generated+cat+video")
        page.wait_for_timeout(4000)
        page.mouse.wheel(0, 800); page.wait_for_timeout(1500); page.mouse.wheel(0, -800)
        reason = None
        for _ in range(15):
            reason = page.evaluate("() => document.querySelector('.ss-blur > .ss-show')?.textContent || null")
            if reason: break
            page.wait_for_timeout(2000)
        page.screenshot(path=f"{SHOTS}/blur_mode.png")
        print("blur overlay:", reason)
        if not reason or reason.startswith("Hidden by"):
            failures.append(f"blur overlay has no reason: {reason!r}")
        else:
            page.evaluate("() => document.querySelector('.ss-blur > .ss-notai').click()")
            page.wait_for_timeout(1500)
            allowed = pop.evaluate("() => chrome.storage.local.get('allowed').then(o => Object.keys(o.allowed || {}))")
            print("allowed after Not AI:", allowed)
            if not allowed:
                failures.append("Not AI click stored nothing")

        # 6. Watch page of a labelled video: channel learned once, count = distinct videos
        page.goto(f"https://www.youtube.com/watch?v={AI_LABELLED}")
        page.wait_for_timeout(7000)
        page.goto(f"https://www.youtube.com/watch?v={AI_LABELLED}")  # same video again must not double-count
        page.wait_for_timeout(7000)
        learned = pop.evaluate("() => chrome.storage.local.get('learned').then(o => o.learned || {})")
        mine = [v for v in learned.values() if AI_LABELLED in (v.get("vids") or [])]
        print("learned entry for labelled video:", mine[:1])
        if not mine:
            failures.append("watch page did not learn the labelled video's channel")
        elif mine[0]["vids"].count(AI_LABELLED) != 1:
            failures.append("same video counted twice")
        quota = pop.evaluate("() => chrome.storage.local.get('quota').then(o => o.quota)")
        print("daily quota used:", quota)

        ctx.close()
    if errors:
        print("console errors:", errors[:5])
    print("FAIL:\n- " + "\n- ".join(failures) if failures else "PASS")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
