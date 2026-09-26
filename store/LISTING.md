# Chrome Web Store listing: Slop Shield 1.0

Copy these fields into the Developer Dashboard. Everything here must stay true to what the tests show.

## Store listing tab
**Name:** Slop Shield: Hide AI videos on YouTube

**Summary (max 132 chars):**
Hide YouTube videos labelled "Made with AI", auto-skip AI Shorts, block slop channels. Runs locally. No data collected.

**Category:** Productivity. **Language:** English.

**Description:**
YouTube labels many AI-generated videos "Made with AI", but it hides the label deep in the description and gives you no way to filter. Slop Shield reads that label for you.

WHAT IT DOES
• Hides (or blurs) videos YouTube labels "Made with AI" in search results, the related-videos column and Shorts shelves
• Auto-skips AI-labelled Shorts in the Shorts feed, with a "Not AI? Go back" button
• Hides Shorts whose titles say they're AI-made (#ai, "AI cat video", "made with Sora"), but not news or tutorials about AI
• One-click 🚫 to block any channel
• A channel is hidden only after 2 different labelled videos, and verified channels are never hidden wholesale

YOU STAY IN CONTROL
• Every hidden video shows why it was hidden (in Blur mode)
• "Not AI" un-hides a video or channel for good
• Hide or Blur mode, with every rule switchable

PRIVATE BY DESIGN
• Runs entirely in your browser. No account, no server, no analytics, no ads
• Nothing is collected or sent anywhere except normal page requests to youtube.com

HONEST LIMITS
Many AI videos aren't labelled by their creators. Slop Shield hides what YouTube itself labels, plus clear AI-made Shorts and channels you block. It does not guess from pixels: those detectors are unreliable and would wrongly flag real creators.

Open source (MIT): github.com/saikumargangi/slop-shield

## Privacy practices tab
**Single purpose:** Hide AI-generated videos on YouTube, using YouTube's own "Made with AI" label and the user's blocks.

**Permission justifications:**
- `storage`: saves the user's settings, blocked channels, "Not AI" choices and a cache of which videos carry YouTube's AI label, locally on the device.
- Host `https://www.youtube.com/*`: needed to hide or blur videos on YouTube pages, and to read the public watch page of videos on screen, where YouTube shows its "Made with AI" label.

**Remote code:** No, I am not using remote code.

**Data usage:** Collects none of the listed data types. Certify:
- ☑ I do not sell or transfer user data to third parties
- ☑ I do not use or transfer user data for purposes unrelated to the single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending

**Privacy policy URL:** https://github.com/saikumargangi/slop-shield/blob/main/PRIVACY.md

## Graphics
- Icon 128×128: `icons/icon128.png`
- Screenshots 1280×800: `store/screenshot-*.png`
- Small promo tile 440×280: `store/promo-440x280.png`

## Before you click Submit (Sai)
- [ ] The Google account has 2-step verification (ideally a passkey or security key)
- [ ] Dashboard → Account: turn on **Verified CRX uploads**, so a phished login can't push a malicious update
- [ ] Upload `store/slop-shield-1.0.0.zip`
- [ ] Visibility: Public (or Unlisted for a quiet first week)
