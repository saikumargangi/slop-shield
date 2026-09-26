"""Headed 'real use' session: browse like a person, screenshot what the extension does.

Run: .venv/bin/python tests/real_use.py   (opens a visible Chromium window)
"""
import hashlib, os, sys
from playwright.sync_api import sync_playwright

EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(EXT, "shots", "real")
PROFILE = os.path.join(EXT, ".profile")  # gitignored test profile, never Sai's own


def ext_id(path):
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])


def counts(page, sel):
    return page.evaluate("""(sel) => { const t = [...document.querySelectorAll(sel)];
      return {tiles: t.length, hidden: t.filter(e => e.classList.contains('ss-hidden') || e.classList.contains('ss-blur')).length}; }""", sel)


def step(name, page, sel=None):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))
    c = counts(page, sel) if sel else ""
    print(f"{name:28} {page.title()[:50]!r:55} {c}")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    yt = "ytd-video-renderer, ytm-shorts-lockup-view-model, ytd-rich-item-renderer, yt-lockup-view-model, ytd-compact-video-renderer"
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, headless=False, locale="en-US", viewport={"width": 1400, "height": 950},
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # YouTube home (logged out) and a typical user search
        page.goto("https://www.youtube.com/"); page.wait_for_timeout(5000)
        step("yt_home", page, yt)
        page.goto("https://www.youtube.com/results?search_query=funny+animals"); page.wait_for_timeout(4000)
        for _ in range(3):
            page.mouse.wheel(0, 900); page.wait_for_timeout(2500)
        page.mouse.wheel(0, -5000); page.wait_for_timeout(3000)
        step("yt_search_funny_animals", page, yt)

        # Watch page of a labelled video: related column
        page.goto("https://www.youtube.com/watch?v=zBeVak5fD9o"); page.wait_for_timeout(8000)
        page.mouse.wheel(0, 600); page.wait_for_timeout(4000)
        step("yt_watch_labelled", page, yt)

        # Shorts feed: full-screen player, no tiles. Does the extension act here at all?
        page.goto("https://www.youtube.com/shorts/zBeVak5fD9o"); page.wait_for_timeout(6000)
        step("yt_shorts_player", page, yt)
        page.keyboard.press("ArrowDown"); page.wait_for_timeout(4000)
        step("yt_shorts_next", page, yt)

        # Etsy: headed browser, may pass the bot wall that blocked headless
        for q in ["ai art print", "crochet bunny", "wall art"]:
            page.goto("https://www.etsy.com/search?q=" + q.replace(" ", "+")); page.wait_for_timeout(7000)
            step("etsy_" + q.replace(" ", "_"), page, "[data-listing-id]")

        pop = ctx.new_page(); pop.goto(f"chrome-extension://{ext_id(EXT)}/popup.html"); pop.wait_for_timeout(800)
        pop.screenshot(path=os.path.join(SHOTS, "popup.png"))
        ctx.close()


if __name__ == "__main__":
    main()
