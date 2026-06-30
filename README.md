# 🌎 WORLD MIXTAPE

The world's local music, decade by decade. Tap a country on the map and travel its
sound from the 1920s to now — **local artists only** (natives + diaspora, no imports),
curated for cultural significance over chart position.

Live: **https://worldmixtape.com**

- A D3 world map *is* the navigation
- A Radiooooo-style era axis (NOW · 2020s … 50s · 40s · PRE-40s), ~25–50 tracks per era
- Dig by genre, shuffle (the whole world or one country / era / genre), save favorites
- 30-second previews via Deezer; optional full songs via Spotify Premium

Static site — no backend, no build step: `index.html`, `app.js`, `data.js`,
`styles.css`, `spotify.js`. Serve locally with `python3 -m http.server 8080`.
