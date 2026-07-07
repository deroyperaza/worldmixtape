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
      { id: "electronic-focus", name: "Modern Electronic", sub: "instrumental electronica for the flow — downtempo, ambient-techno, synth", emoji: "🎛️", trackIds: [860375402,12266089,66537630,140599781,3263565081,2009470487,3601708652,603342962,677144832] },
      { id: "meditative-focus", name: "Meditative", sub: "slow, spacious & still — ambient, neoclassical, solo piano", emoji: "🧘", trackIds: [13202819,13202825,6058030,2402663105,625571952,62743862,62742667,1522716902,2384671095,2384670975,115782512,115782402,2782140912] },
      { id: "folk-focus", name: "Folk & Acoustic", sub: "fingerpicked, plucked & bowed — world folk traditions, no words", emoji: "🪕", trackIds: [623421062,90270219,2145299447,548784,864289,1104080,1168313,3675886562,1787551937,3786142442,16334364,15935606,45851171,99269422,252016,62914729,63186348,1296821292,64909865,36436321,238405,144701112,1939664327,957776322] },
    ],
  },
  {
    banner: "💪 Built to sweat",
    note: "High-energy bangers to move to, by flavor — vocals fully welcome. Turn it up.",
    playlists: [
      { id: "workout-afro", name: "Afro Heat", sub: "afrobeats, amapiano & highlife — full-throttle African dancefloor", emoji: "🔥", trackIds: [3917266381,3880873041,2628211752,4078366841,2381294455,1557178292,1873297197,752155092,1755868257,3515176611,72717420,3491736151,515871052,1807498027,4052840701,10245662,2676226,3864827291,3207093961,3998236631,88375983,3234255541,1593201331,2650969032,1015793062,2303976605,1352054212,3871557291,1103776572,3897770841] },
      { id: "workout-latin", name: "Latin Fire", sub: "reggaeton, dembow & dancehall — máximo perreo energy", emoji: "💃", trackIds: [364292561,3171003001,3171003031,58786641,619949882,3938061401,3981947521,127245209,365643061,796342592,3959416561,3948851331,4118919301,3359727771,2794644062,4762499,426656532,83361154,3765607912,4050690001,80964550,3949568591,1480970322,112693068,384767561,3993332991,715415322,4084154311,123345682,390959001] },
      { id: "workout-club", name: "Global Club", sub: "house, techno & EDM — four-on-the-floor fuel", emoji: "🎧", trackIds: [3544008,62847142,13040252,4306223,4306226,14383880,4286051,67625876,62126191,62126185,3252242,10284847,4049303451,716383912,716383902,3286437,89760555,3960720871,2471458441,2640749462,1384261522,72327967,107471416,3635936502,12756253,3527552881,15543742,88951133,45544471,62203269] },
      { id: "workout-rap", name: "Rap Worldwide", sub: "hard rap & trap from every corner — Lagos to Paris to LA", emoji: "🎤", trackIds: [4100961451,528869611,124603286,97206068,350171311,412843352,541418402,4081475291,1425844092,3968718811,93011198,2346695655,3553677361,1709433847,994959062,1254648512,6717372,1370066842,4050877981,7217342,134774924,1687953667,393705402,1049272552,2103405097,1811481707,1952541187,4086559301,4062658891,66027642] },
    ],
  },
  {
    tag: "WORLD CUP · QUARTERFINALS",
    banner: "⚽ World Cup mixtapes",
    note: "Every quarterfinal — both nations' uptempo music since 2000, mixed into one playlist.",
    playlists: [
      { id: "qf-fra-mar", name: "France × Morocco",       sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["FR","MA"], since: 2000, uptempo: true, when: "July 9" },
      { id: "qf-esp-bel", name: "Spain × Belgium",         sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["ES","BE"], since: 2000, uptempo: true, when: "July 10" },
      { id: "qf-nor-eng", name: "Norway × England",        sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["NO","GB"], since: 2000, uptempo: true, when: "July 11" },
      { id: "qf-arg-sui", name: "Argentina × Switzerland", sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["AR","CH"], since: 2000, uptempo: true, when: "July 11" },
    ],
  },
  {
    tag: "WORLD CUP · ROUND OF 16",
    banner: "⚽ World Cup mixtapes",
    note: "Every Round of 16 matchup, both countries' uptempo music since 2000, mixed into one playlist. Two nations, one tape.",
    playlists: [
      { id: "wc-can-mar", name: "Canada × Morocco",       sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["CA","MA"], since: 2000, uptempo: true, when: "July 4", where: "Houston" },
      { id: "wc-par-fra", name: "Paraguay × France",      sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["PY","FR"], since: 2000, uptempo: true, when: "July 4", where: "Philadelphia" },
      { id: "wc-bra-nor", name: "Brazil × Norway",        sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["BR","NO"], since: 2000, uptempo: true, when: "July 5", where: "New York" },
      { id: "wc-mex-eng", name: "Mexico × England",       sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["MX","GB"], since: 2000, uptempo: true, when: "July 5", where: "Mexico City" },
      { id: "wc-por-esp", name: "Portugal × Spain",       sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["PT","ES"], since: 2000, uptempo: true, when: "July 6", where: "Dallas" },
      { id: "wc-usa-bel", name: "United States × Belgium", sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["US","BE"], since: 2000, uptempo: true, when: "July 6", where: "Seattle" },
      { id: "wc-arg-egy", name: "Argentina × Egypt",      sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["AR","EG"], since: 2000, uptempo: true, when: "July 7", where: "Atlanta" },
      { id: "wc-sui-col", name: "Switzerland × Colombia", sub: "uptempo · since 2000, mixed", emoji: "⚽", teams: ["CH","CO"], since: 2000, uptempo: true, when: "July 7", where: "Vancouver" },
    ],
  },
];
if (typeof module !== "undefined" && module.exports) module.exports = FEATURED_GROUPS;
