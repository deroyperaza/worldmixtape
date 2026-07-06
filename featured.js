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
