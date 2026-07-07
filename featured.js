/* WORLD MIXTAPE — FEATURED PLAYLISTS (curated, pushed to all users).
   Edit this list + deploy to change what everyone sees under the "featured" pill.
   Each playlist's tracks are built at runtime from the catalog by buildFeaturedMix()
   in app.js — no track IDs to maintain here, just the recipe.

   Fields:
     id     unique slug
     name   card + header title  (use "A × B" for a matchup)
     sub    small subtitle
     emoji  card icon
     teams  array of country codes to draw from (2 for a matchup)
     since  only include tracks from this year onward (default 2000)
     tag    optional group label (e.g. "WORLD CUP") shown as a section banner
     limit  optional max tracks (default 40)

   The 8 entries below are the 2026 FIFA World Cup Round of 16 matchups (July 4–7, 2026).
   "England" draws from the catalog's GB (United Kingdom) music. */
const FEATURED_GROUPS = [
  {
    banner: "\uD83C\uDFA7 Made for focus",
    note: "Instrumental, lyric-free tracks from around the world \u2014 calm enough to work to. Auto-built from each song's audio fingerprint (tempo \u00b7 energy \u00b7 vocals).",
    playlists: [
      { id: "deep-focus", name: "Deep Focus", sub: "instrumental \u00b7 calm \u00b7 no lyrics", emoji: "\uD83C\uDFA7",
        filter: { instrumental: true, energyBand: ["calm","moderate"], tempoBand: ["slow","mid"] }, limit: 80 },
      { id: "electronic-focus", name: "Modern Electronic", sub: "instrumental electronica for the flow — downtempo, ambient-techno, synth", emoji: "🎛️", trackIds: [3871666931,860375402,12266089,66537630,140599781,3263565081,2009470487,3601708652,603342962,677144832] },
      { id: "meditative-focus", name: "Meditative", sub: "slow, spacious & still — ambient, neoclassical, solo piano", emoji: "🧘", trackIds: [13202819,13202825,6058030,2402663105,625571952,62743862,62742667,1522716902,2384671095,2384670975,115782512,115782402,2782140912] },
      { id: "folk-focus", name: "Folk & Acoustic", sub: "fingerpicked, plucked & bowed — world folk traditions, no words", emoji: "🪕", trackIds: [623421062,90270219,2145299447,548784,864289,1104080,1168313,3675886562,1787551937,3786142442,16334364,15935606,45851171,99269422,252016,62914729,63186348,1296821292,64909865,36436321,238405,144701112,1939664327,957776322] },
    ],
  },
  {
    tag: "WORLD CUP · ROUND OF 16",
    banner: "⚽ World Cup mixtapes",
    note: "Every Round of 16 matchup, both countries' music since 2000, mixed into one playlist. Two nations, one tape.",
    playlists: [
      { id: "wc-can-mar", name: "Canada × Morocco",       sub: "music since 2000, mixed", emoji: "⚽", teams: ["CA","MA"], since: 2000, when: "July 4", where: "Houston" },
      { id: "wc-par-fra", name: "Paraguay × France",      sub: "music since 2000, mixed", emoji: "⚽", teams: ["PY","FR"], since: 2000, when: "July 4", where: "Philadelphia" },
      { id: "wc-bra-nor", name: "Brazil × Norway",        sub: "music since 2000, mixed", emoji: "⚽", teams: ["BR","NO"], since: 2000, when: "July 5", where: "New York" },
      { id: "wc-mex-eng", name: "Mexico × England",       sub: "music since 2000, mixed", emoji: "⚽", teams: ["MX","GB"], since: 2000, when: "July 5", where: "Mexico City" },
      { id: "wc-por-esp", name: "Portugal × Spain",       sub: "music since 2000, mixed", emoji: "⚽", teams: ["PT","ES"], since: 2000, when: "July 6", where: "Dallas" },
      { id: "wc-usa-bel", name: "United States × Belgium", sub: "music since 2000, mixed", emoji: "⚽", teams: ["US","BE"], since: 2000, when: "July 6", where: "Seattle" },
      { id: "wc-arg-egy", name: "Argentina × Egypt",      sub: "music since 2000, mixed", emoji: "⚽", teams: ["AR","EG"], since: 2000, when: "July 7", where: "Atlanta" },
      { id: "wc-sui-col", name: "Switzerland × Colombia", sub: "music since 2000, mixed", emoji: "⚽", teams: ["CH","CO"], since: 2000, when: "July 7", where: "Vancouver" },
    ],
  },
];
if (typeof module !== "undefined" && module.exports) module.exports = FEATURED_GROUPS;
