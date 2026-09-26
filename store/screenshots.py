"""Build Chrome Web Store screenshots (1280x800) from REAL captures of the extension.

Run: .venv/bin/python store/screenshots.py
"""
import base64, hashlib, os
from playwright.sync_api import sync_playwright

EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(EXT, "store")
RAW = os.path.join(EXT, "shots", "store_raw")
AI_SHORT = "GYZJsM7sOKU"  # YouTube-labelled "Made with AI" (verified 2026-09-26)


def ext_id(path):
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])


def go(page, url):
    # YouTube's SPA sometimes aborts a navigation mid-flight; one retry is enough
    try:
        page.goto(url)
    except Exception:
        page.wait_for_timeout(1500); page.goto(url)


def capture():
    os.makedirs(RAW, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            os.path.join(EXT, ".profile"), headless=False, locale="en-US", viewport={"width": 1280, "height": 760},
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        pop = ctx.new_page()
        pop.goto(f"chrome-extension://{ext_id(EXT)}/popup.html")
        pop.evaluate("() => chrome.storage.local.get('settings').then(o => chrome.storage.local.set({settings: {...(o.settings||{}), enabled: true, mode: 'blur'}}))")
        page = ctx.pages[0]
        # A normal search: labelled AI videos get blurred with their reason, real ones untouched (precision)
        go(page, "https://www.youtube.com/results?search_query=lofi+music")
        page.wait_for_timeout(4000)
        for _ in range(4):
            page.mouse.wheel(0, 900); page.wait_for_timeout(2500)
        page.mouse.wheel(0, -8000); page.wait_for_timeout(4000)
        for _ in range(4):
            page.mouse.wheel(0, 500); page.wait_for_timeout(2500)
        page.evaluate("""() => { const t = document.querySelector('ytd-video-renderer.ss-blur');
            if (t) { t.scrollIntoView({block: 'start'}); window.scrollBy(0, -170); } }""")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{RAW}/blur.png")
        page.set_viewport_size({"width": 1280, "height": 600})  # keep the skip notice inside the crop
        page.goto(f"https://www.youtube.com/shorts/{AI_SHORT}", wait_until="commit")
        for _ in range(20):
            page.wait_for_timeout(400)
            if page.evaluate("!!document.querySelector('.ss-toast')"): break
        page.wait_for_timeout(1800)  # let the next (real) Short render behind the notice
        page.screenshot(path=f"{RAW}/shorts.png")
        pop.set_viewport_size({"width": 340, "height": 640})
        pop.reload(); pop.wait_for_timeout(1000)
        pop.screenshot(path=f"{RAW}/popup.png", full_page=True)
        ctx.close()


FRAME = """<html><body style="margin:0;width:1280px;height:800px;overflow:hidden;
 background:linear-gradient(160deg,#1e1b4b 0%,#312e81 55%,#4f46e5 100%);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#fff">
 <div style="padding:34px 56px 0;display:flex;align-items:center;gap:14px">
   <img src="data:image/png;base64,{icon}" style="width:40px;height:40px">
   <div style="font-size:15px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Slop Shield</div></div>
 <div style="padding:10px 56px 0;font-size:40px;font-weight:800;letter-spacing:-.02em">{title}</div>
 <div style="padding:8px 56px 0;font-size:19px;opacity:.85">{sub}</div>
 <div style="position:absolute;left:{x}px;top:210px;width:{w}px;height:560px;border-radius:14px;overflow:hidden;
   box-shadow:0 24px 60px rgba(0,0,0,.45);background:#fff">
   <img src="data:image/png;base64,{shot}" style="width:100%;display:block"></div>
</body></html>"""


def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()


def compose():
    icon = b64(os.path.join(EXT, "icons", "icon128.png"))
    frames = [
        ("screenshot-1-blur.png", "blur.png", "Hides videos YouTube labels “Made with AI”",
         "Real videos stay. Every hidden one says why, and “Not AI” brings it back.", 56, 1168),
        ("screenshot-2-shorts.png", "shorts.png", "Auto-skips AI Shorts in the Shorts feed",
         "Uses YouTube’s own label, and tells you every time it skips.", 56, 1168),
        ("screenshot-3-popup.png", "popup.png", "You stay in control",
         "Hide or blur · block any channel · runs locally, nothing leaves your browser.", 470, 340),
    ]
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 800})
        for out, raw, title, sub, x, w in frames:
            pg.set_content(FRAME.format(icon=icon, shot=b64(os.path.join(RAW, raw)), title=title, sub=sub, x=x, w=w))
            pg.wait_for_timeout(300)
            pg.screenshot(path=os.path.join(OUT, out))
        # small promo tile 440x280
        pg.set_viewport_size({"width": 440, "height": 280})
        pg.set_content(f"""<html><body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:18px;padding:0 30px;box-sizing:border-box;
          background:linear-gradient(160deg,#1e1b4b,#4f46e5);color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
          <img src="data:image/png;base64,{icon}" style="width:96px;height:96px">
          <div><div style="font-size:30px;font-weight:800">Slop Shield</div>
          <div style="font-size:15px;opacity:.9;margin-top:6px">Hide AI videos on YouTube</div></div></body></html>""")
        pg.screenshot(path=os.path.join(OUT, "promo-440x280.png"))
        b.close()


if __name__ == "__main__":
    capture()
    compose()
    print("done:", sorted(f for f in os.listdir(OUT) if f.endswith(".png")))
