---
task: Enable background audio playback on locked iPhone
slug: 20260706-162728_ios-background-audio-current-site
effort: standard
phase: verify
progress: 8/8
mode: interactive
started: 2026-07-06T16:27:28Z
updated: 2026-07-06T16:29:00Z
---

## Context

Deroy wants to know whether the CURRENT worldmixtape.com (before any native-app work) can be made to keep playing audio when the iPhone screen is locked / user leaves the homescreen (iOS background audio). This is a feasibility investigation of the existing web architecture, not a green-field build. Relates to [[world-mixtape-native-app-strategy]] and [[world-mixtape-youtube-playback]].

### Findings (verified in ~/worldmixtape)
- Full songs play via a hidden, off-screen **YouTube IFrame player** (`#yt-player`, index.html:127; `onYouTubeIframeAPIReady`, app.js:1494). ~100% of the catalog is full-song YouTube.
- Previews play via a native **`<audio id="audio">`** element (index.html:125; app.js:1206) with Deezer/iTunes 30s MP3s.
- **Media Session API is completely absent** (0 references in app.js) — no lock-screen metadata or controls today.
- Manifest is `display: standalone` (installable PWA) but there is **no service worker** and no `apple-mobile-web-app-capable` meta.
- The code already documents YouTube stalling when backgrounded (app.js:1513-1514 watchdog comment: "esp. on mobile/backgrounded tabs").

### Verdict
- **YouTube iframe cannot background on iOS.** WebKit suspends cross-origin iframe media on lock/background; YouTube also disallows embed background playback on mobile by design. Media Session can't help — you don't own the media element inside the iframe. Not fixable in this architecture.
- **Native `<audio>` CAN background on iOS** if playback starts from a user gesture + Media Session is wired up. But it only covers the 30s previews.
- Real full-length background + lock screen + CarPlay requires a native audio source you control (self-host = licensing blocker) or a native app with MusicKit — i.e. the documented native-app strategy.

## Criteria
- [x] ISC-1: Verify full-song path uses hidden YouTube IFrame player
- [x] ISC-2: Verify preview path uses native `<audio id=audio>` element
- [x] ISC-3: Verify Media Session API is absent from app.js
- [x] ISC-4: Verify manifest display mode and service-worker presence
- [x] ISC-5: Determine iOS background capability of YouTube iframe (no)
- [x] ISC-6: Determine iOS background capability of native audio (yes, conditional)
- [x] ISC-7: Identify the one web-shippable improvement (Media Session on preview path)
- [x] ISC-8: Confirm full-song background needs native app / non-iframe source

## Decisions
- No code changed this pass — investigation + recommendation only, pending Deroy's call on whether the preview-only Media Session win is worth shipping.

## Verification
- Architecture confirmed by grep (LC_ALL=C) + Read of app.js:1280-1600, index.html, site.webmanifest.
- youtube=202 refs, ytId=17, native audio element present, mediaSession=0, no serviceWorker registration.
