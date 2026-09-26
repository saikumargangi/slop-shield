"""Headed check: Shorts feed auto-skips a YouTube-labelled AI Short, leaves a real one alone."""
import os, sys
from playwright.sync_api import sync_playwright
EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI_SHORT = "GYZJsM7sOKU"  # carries "Made with AI" (verified 2026-09-26)
fails = []
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(os.path.join(EXT, ".profile"), headless=False, locale="en-US",
        viewport={"width": 1400, "height": 950}, args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    page = ctx.pages[0]
    page.goto("https://www.youtube.com/results?search_query=funny+animals"); page.wait_for_timeout(5000)
    real = page.evaluate("""() => [...document.querySelectorAll('a[href^="/shorts/"]')].map(a => a.getAttribute('href'))[0]""")
    page.goto("https://www.youtube.com/shorts/" + AI_SHORT)
    moved, toast = False, None
    for _ in range(20):
        page.wait_for_timeout(500)
        toast = toast or page.evaluate("document.querySelector('.ss-toast')?.textContent || null")
        if AI_SHORT not in page.url: moved = True; break
    page.wait_for_timeout(800)
    page.screenshot(path=os.path.join(EXT, "shots/real/shorts_skip.png"))
    print("AI short -> moved:", moved, "| now:", page.url[-20:], "| toast:", toast)
    if not moved: fails.append("AI-labelled Short was not skipped")
    if not toast: fails.append("no skip notice shown")
    page.goto("https://www.youtube.com" + real); page.wait_for_timeout(9000)
    stayed = real in page.url
    print("real short", real, "-> stayed:", stayed)
    if not stayed: fails.append("real Short was skipped")
    ctx.close()
print("FAIL: " + "; ".join(fails) if fails else "PASS"); sys.exit(1 if fails else 0)
