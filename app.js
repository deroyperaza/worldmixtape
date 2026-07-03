/* ===================== WORLD MIXTAPE — app logic ===================== */
const ATLAS = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// iso-numeric -> our code
const isoToCode = {};
Object.entries(COUNTRIES).forEach(([code, c]) => { isoToCode[+c.iso] = code; });

// teams that played the 2026 FIFA World Cup (⚽ sticker on their country label)
const WC2026 = new Set(["AR","AU","BR","CA","CO","EG","ES","FR","GB","GH","JP","KR","MX","PA","SN","TR","US","ZA","DE","CD","CV","PT","TN","CI","NO","SE","EC","BE","BA","AT","HR","CH","DZ","MA","PY","NL","UY","IR","NZ","JO","UZ","SA","QA","IQ","CZ","HT","CW"]);

// men's FIFA World Cup winners → number of titles (🏆 stickers + a ⚽ on the country-info overlay header)
const WC_TITLES = { BR:5, DE:4, IT:4, AR:3, FR:2, UY:2, GB:1, ES:1 };

// alpha-2 code -> flag emoji
const flag = code => code.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt()));
// flat SVG flags (match the riso aesthetic better than wavy emoji)
const flagImg = (code, cls) => `<img class="flag${cls ? " " + cls : ""}" src="https://flagcdn.com/${code.toLowerCase()}.svg" alt="${code}" loading="lazy">`;

/* ---------- ticker ---------- */
(() => {
  const names = Object.entries(COUNTRIES).map(([code, c]) => `${flagImg(code)} ${c.name.toUpperCase()}`);
  const songs = Object.values(COUNTRIES).reduce((n, c) => n + Object.values(c.eras).reduce((m, e) => m + e.length, 0), 0);
  const hours = Math.round(songs * 245.9 / 3600);   // 245.9s = mean track length, measured across the full Deezer duration scan (7,002 tracks)
  const msg = `★ NOW BROADCASTING ★ ${names.length} COUNTRIES ★ ${songs.toLocaleString()} SONGS ★ ${hours.toLocaleString()} HOURS OF MUSIC ★ A CENTURY OF SOUND ★ 1920s TO NOW ★ NO IMPORTS ★ ${names.join("  ·  ")}  ·  `;
  document.getElementById("ticker").innerHTML = msg + msg;
})();

/* ---------- map ---------- */
const svg = d3.select("#map");
const gMap = svg.append("g");
const tip = document.getElementById("tip");
let projection, path, features = [];

function sizeOf() {
  const w = document.getElementById("map-wrap").clientWidth;
  const h = document.getElementById("map-wrap").clientHeight;
  return [w, h];
}

function drawCountries() {
  const [w, h] = sizeOf();
  svg.attr("viewBox", `0 0 ${w} ${h}`);
  projection = d3.geoNaturalEarth1().fitExtent([[10, 16], [w - 10, h - 24]], { type: "FeatureCollection", features });
  path = d3.geoPath(projection);
  gMap.selectAll("path.country").attr("d", path);
}

const zoom = d3.zoom().scaleExtent([1, 12])
  .on("zoom", e => { gMap.attr("transform", e.transform); });

d3.json(ATLAS).then(world => {
  features = topojson.feature(world, world.objects.countries).features;
  const [w, h] = sizeOf();
  projection = d3.geoNaturalEarth1().fitExtent([[10, 16], [w - 10, h - 24]], { type: "FeatureCollection", features });
  path = d3.geoPath(projection);

  gMap.selectAll("path.country")
    .data(features).enter().append("path")
    .attr("class", d => isoToCode[+d.id] ? "country feat" : "country dim")
    .attr("d", path)
    .style("fill", d => { const c = isoToCode[+d.id]; return c ? COUNTRIES[c].color : null; }) // inline style beats stylesheet
    .style("color", d => { const c = isoToCode[+d.id]; return c ? COUNTRIES[c].color : null; }) // for currentColor glow
    .on("pointermove", (e, d) => showTip(e, d))
    .on("pointerleave", hideTip)
    .on("click", (e, d) => onCountry(e, d));

  svg.call(zoom);
  if (document.body.classList.contains("list-view")) buildCountryList();
});

function nameOf(d){ const c = isoToCode[+d.id]; return c ? COUNTRIES[c].name : (d.properties && d.properties.name) || "Somewhere"; }

function showTip(e, d) {
  const c = isoToCode[+d.id];
  tip.innerHTML = `${c ? flagImg(c) + " " : ""}${esc(nameOf(d))}`;
  tip.classList.toggle("feat", !!c);
  tip.style.left = e.clientX + "px";
  tip.style.top = e.clientY + "px";
  tip.style.opacity = 1;
}
function hideTip(){ tip.style.opacity = 0; }

window.addEventListener("resize", () => { if (features.length) drawCountries(); });

/* ---------- panel ---------- */
const panel = document.getElementById("panel");
const scrim = document.getElementById("scrim");
const inner = document.getElementById("panel-inner");
let activeCode = null, queue = [], qIndex = -1, currentEra = "now", currentGenre = null, renderedList = null;
let favFilterCC = null, favFilterGenre = null;   // active country / genre filters in the Favorites tab

/* ---------- favorites (persisted to localStorage) ---------- */
const FAV_KEY = "wmx_favs_v1";
let favs = (() => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } })();
// live-catalog index → re-hydrate favorites saved before ytIds existed (they lacked ytId → showed "30s")
const CATALOG_BY_ID = {};
(() => { for (const c of Object.values(COUNTRIES)) for (const e of Object.values(c.eras)) for (const t of e){ if (t.trackId != null) CATALOG_BY_ID[String(t.trackId)] = t; } })();
function hydrateFav(f){
  if (!f || f.ytId) return f;
  const cat = CATALOG_BY_ID[String(f.trackId)];   // same trackId now carries a ytId → full song
  if (cat && cat.ytId){ f.ytId = cat.ytId; if (cat.cover) f.cover = cat.cover; }
  return f;
}
function hydrateFavs(){ if (Array.isArray(favs)) favs.forEach(hydrateFav); }
// match trackIds type-agnostically — Deezer ids are numbers, iTunes ids are "it123" strings,
// and localStorage/DOM datasets stringify them; comparing as strings makes un-hearting reliable
const isFav = id => favs.some(f => String(f.trackId) === String(id));
function saveFavs(){ if (!(authUser && FB)){ try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {} } updateFavCount(); }
function toggleFav(t, cc){
  if (authUser && FB){   // signed in → write to the cloud (live snapshot reconciles; optimistic update for snappiness)
    const col = FB.firestore().collection("users").doc(authUser.uid).collection("favorites");
    const id = String(t.trackId);
    if (isFav(t.trackId)){ favs = favs.filter(f => String(f.trackId) !== id); col.doc(id).delete().catch(e => console.warn(e)); }
    else { favs.unshift(favRecord(t, cc)); col.doc(id).set(Object.assign(favRecord(t, cc), { addedAt: FB.firestore.FieldValue.serverTimestamp() })).catch(e => console.warn(e)); }
    updateFavCount();
  } else {               // anonymous → localStorage
    if (isFav(t.trackId)) favs = favs.filter(f => String(f.trackId) !== String(t.trackId));
    else favs.unshift(favRecord(t, cc));
    saveFavs();
  }
}
function updateFavCount(){
  const el = document.getElementById("fav-count");
  if (el){ el.textContent = favs.length; el.closest(".faves-btn").classList.toggle("has", favs.length > 0); }
}
function refreshFavHearts(){
  document.querySelectorAll(".track__fav").forEach(el => el.classList.toggle("on", isFav(el.dataset.id)));
  const cur = !!(qIndex >= 0 && queue[qIndex] && isFav(queue[qIndex].trackId));
  const pf = document.getElementById("p-fav");
  if (pf) pf.classList.toggle("on", cur);
  const af = document.getElementById("art-fav");
  if (af) af.classList.toggle("on", cur);
  const fm = document.getElementById("fav-meta"); if (fm && !/SHUFFLED/.test(fm.textContent)) fm.textContent = favs.length + " SAVED · TAP ♥ TO REMOVE";
  updateFavCount();
}
/* ---------- import an old #favs= share link if present (superseded by account sync, kept harmless) ---------- */
function importFavsFromHash(){
  const m = /[#&]favs=([^&]+)/.exec(location.hash || "");
  if (!m) return;
  let incoming;
  try { incoming = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch { history.replaceState(null, "", location.pathname + location.search); return; }
  history.replaceState(null, "", location.pathname + location.search);   // strip the long hash from the URL
  if (!Array.isArray(incoming)) return;
  const have = new Set(favs.map(f => String(f.trackId)));
  const fresh = incoming.filter(f => f && f.trackId != null && !have.has(String(f.trackId)));
  if (!fresh.length){ flashToast("favorites already in sync"); return; }
  if (authUser && FB){   // signed in → merge into the cloud account
    const col = FB.firestore().collection("users").doc(authUser.uid).collection("favorites");
    const batch = FB.firestore().batch();
    fresh.forEach(f => batch.set(col.doc(String(f.trackId)), Object.assign(favRecord(f), { addedAt: FB.firestore.FieldValue.serverTimestamp() })));
    batch.commit().catch(e => console.warn(e));
  } else {
    fresh.forEach(f => favs.push(f));
    saveFavs();
  }
  flashToast(fresh.length + " favorite" + (fresh.length > 1 ? "s" : "") + " added from your other device");
}
function flashToast(msg){
  let el = document.getElementById("wmx-toast");
  if (!el){ el = document.createElement("div"); el.id = "wmx-toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; void el.offsetWidth; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 3400);
}

/* ---------- accounts + cloud sync (Firebase Auth + Firestore) ---------- */
const FB = (window.firebase && firebase.apps && firebase.apps.length) ? firebase : null;
let authUser = null, favUnsub = null, globalFaves = 0;
const trackFaveCounts = {};   // trackId -> fave count (cached from trackStats reads)

// undefined values break Firestore writes, so default every field
function favRecord(t, cc){
  return { trackId: t.trackId, artist: t.artist || "", title: t.title || "", cover: t.cover || "",
    year: t.year || null, genre: t.genre || "", album: t.album || "", artistId: t.artistId || null,
    decade: t.decade || "", diaspora: !!t.diaspora, ytId: t.ytId || (CATALOG_BY_ID[String(t.trackId)] || {}).ytId || null,
    _cc: t._cc || cc || null };
}
function loadLocalFavs(){ try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } }
function favoritesIsOpen(){ const h = inner.querySelector(".jhead__name"); return panel.classList.contains("show") && !!h && h.textContent.trim().toLowerCase() === "favorites"; }
function refreshFavoritesView(){ if (favoritesIsOpen()) openFavorites(); }

if (FB){
  const auth = FB.auth(), db = FB.firestore();
  const userFavs = uid => db.collection("users").doc(uid).collection("favorites");

  // Popup sign-in. signInWithRedirect is broken here because authDomain
  // (world-mix-tape.firebaseapp.com) differs from the site's domain, so browser
  // storage partitioning loses the redirect result. Popup returns the credential
  // via postMessage and sidesteps that. Fall back to redirect only when a popup
  // genuinely can't open (in-app browsers / popup-blocked).
  window.signInGoogle = async () => {
    const provider = new FB.auth.GoogleAuthProvider();
    try {
      flashToast("opening Google sign-in…");
      await auth.signInWithPopup(provider);   // success handled by onAuthStateChanged
    } catch (e) {
      console.warn("popup sign-in", e);
      const code = e && e.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return; // user dismissed
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        flashToast("redirecting to Google…");
        auth.signInWithRedirect(provider).catch(er => { console.warn("redirect", er); flashToast("sign-in error: " + (er.code || "failed")); });
        return;
      }
      flashToast("sign-in error: " + (code || "failed"));
    }
  };
  window.signOutUser = () => auth.signOut();
  // handles the redirect fallback path (in-app browsers); popup resolves inline above
  auth.getRedirectResult().catch(e => { console.warn("redirect", e); if (e && e.code) flashToast("sign-in error: " + e.code); });

  auth.onAuthStateChanged(async u => {
    authUser = u || null;
    if (favUnsub){ favUnsub(); favUnsub = null; }
    if (u){
      await migrateLocalToCloud(u.uid).catch(e => console.warn("migrate", e));
      favUnsub = userFavs(u.uid).orderBy("addedAt", "desc").onSnapshot(snap => {
        favs = snap.docs.map(d => d.data());
        updateFavCount(); refreshFavHearts(); refreshFavoritesView();
      }, err => console.warn("favorites sync", err));
    } else {
      favs = loadLocalFavs();
      updateFavCount(); refreshFavHearts();
    }
    refreshFavoritesView();
  });

  async function migrateLocalToCloud(uid){
    const local = loadLocalFavs();
    if (!local.length) return;
    const col = userFavs(uid);
    const snap = await col.get();
    const have = new Set(snap.docs.map(d => d.id));
    const batch = db.batch(); let n = 0;
    local.forEach(t => { const id = String(t.trackId); if (t.trackId != null && !have.has(id)){ batch.set(col.doc(id), Object.assign(favRecord(t), { addedAt: FB.firestore.FieldValue.serverTimestamp() })); n++; } });
    if (n) await batch.commit();
    try { localStorage.removeItem(FAV_KEY); } catch {}   // cloud is the source of truth once signed in
    if (n) flashToast(n + " saved track" + (n > 1 ? "s" : "") + " synced to your account");
  }

  // live global counter
  db.collection("stats").doc("global").onSnapshot(d => { globalFaves = (d.exists && d.data().totalFaves) || 0; renderGlobalCount(); }, () => {});
}

// account row shown in the Favorites panel
function accountRowHTML(){
  if (!FB) return "";   // Firebase unavailable → no account UI (favorites still work via localStorage)
  let body = "";
  if (FB){
    if (authUser){
      const name = (authUser.displayName || authUser.email || "you");
      const initial = esc((name || "?").trim().charAt(0).toUpperCase() || "?");
      const pic = authUser.photoURL
        ? `<img class="acct__pic" src="${esc(authUser.photoURL)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'acct__pic acct__pic--txt',textContent:'${initial}'}))">`
        : `<span class="acct__pic acct__pic--txt">${initial}</span>`;
      body = `<button class="acct__btn acct__signed" id="acct-out" title="Signed in as ${esc(name)} — sign out">${pic}<span>sign out</span></button>`;
    } else {
      body = `<button class="acct__btn acct__in" id="acct-in"><svg class="acct__g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Sign in to save across devices</button>`;
    }
  }
  return `<div class="acct">${body}<div class="acct__global" hidden></div></div>`;
}
function wireAccountButtons(){
  const i = inner.querySelector("#acct-in"); if (i) i.onclick = () => window.signInGoogle && window.signInGoogle();
  const o = inner.querySelector("#acct-out"); if (o) o.onclick = () => window.signOutUser && window.signOutUser();
  renderGlobalCount();
}
function renderGlobalCount(){
  const el = inner.querySelector(".acct__global"); if (!el) return;
  if (globalFaves > 0){ el.textContent = "🌍 " + globalFaves.toLocaleString() + " tracks hearted worldwide"; el.hidden = false; }
  else el.hidden = true;
}

// fetch per-track fave counts for a rendered list (batched, cached) and paint them
async function fillTrackCounts(list, tl){
  if (!FB) return;
  const db = FB.firestore();
  const need = [...new Set(list.map(t => String(t.trackId)))].filter(id => trackFaveCounts[id] === undefined);
  for (let i = 0; i < need.length; i += 30){
    const chunk = need.slice(i, i + 30);
    try {
      const snap = await db.collection("trackStats").where(FB.firestore.FieldPath.documentId(), "in", chunk).get();
      const found = new Set();
      snap.forEach(d => { trackFaveCounts[d.id] = d.data().count || 0; found.add(d.id); });
      chunk.forEach(id => { if (!found.has(id)) trackFaveCounts[id] = 0; });
    } catch (e){ console.warn("counts", e); return; }
  }
  paintTrackCounts(list, tl);
}
function paintTrackCounts(list, tl){
  if (!tl) return;
  tl.querySelectorAll(".track__ct").forEach(s => {
    const t = list[+s.dataset.i]; if (!t) return;
    const ct = trackFaveCounts[String(t.trackId)] || 0;
    if (ct > 0){ s.textContent = "♥ " + ct; s.hidden = false; } else { s.textContent = ""; s.hidden = true; }
  });
}

function openFavorites(){
  activeCode = null; currentEra = null; currentGenre = null; favFilterCC = null; favFilterGenre = null;
  if (!favs.length){
    inner.innerHTML = `<div class="jhead"><div class="jhead__top"><div class="jhead__flag jhead__flag--ico">♡</div>
      <h2 class="jhead__name" style="--accent:var(--pink)">Favorites</h2></div></div>
      ${accountRowHTML()}
      <div class="empty">no favorites yet… <em>tap the ♥</em><small>save tracks while you listen and they'll live here.</small></div>`;
    wireAccountButtons(); setShuf(""); openPanel(); return;
  }
  inner.innerHTML = `<div class="jhead"><div class="jhead__top"><div class="jhead__flag jhead__flag--ico">♥</div>
    <h2 class="jhead__name" style="--accent:var(--pink)">Favorites</h2></div>
    <div class="jhead__meta" id="fav-meta"></div></div>
    ${accountRowHTML()}
    <div class="fav-scroll" id="fav-scroll">
      <div class="mixtapes" id="mixtapes"></div>
      <div class="fav-ctrls" id="fav-ctrls"></div>
      <div class="fav-filters" id="fav-filters"></div>
      <div id="tracklist"></div>
    </div>`;
  wireAccountButtons();
  const _fs = inner.querySelector("#fav-scroll");   // whole favorites body scrolls as one (mixtapes scroll away with the list)
  if (_fs) _fs.addEventListener("scroll", () => panel.classList.toggle("scrolled", _fs.scrollTop > 8), { passive: true });
  setShuf("__favs");   // shuffle pre-filtered to favorites
  renderMixStrip();    // auto-generated themed mixtapes across the favorites
  renderFavorites("order");
  openPanel();
}

function renderFavorites(mode){
  hydrateFavs();   // backfill ytId on favorites saved before full-song coverage → drops the "30s" tag
  const shuffled = mode === "shuffle";
  let list = favs.slice();
  if (favFilterCC) list = list.filter(f => f._cc === favFilterCC);        // country / genre filter tags
  if (favFilterGenre) list = list.filter(f => f.genre === favFilterGenre);
  if (shuffled) for (let i = list.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  const curId = (qIndex >= 0 && queue[qIndex]) ? queue[qIndex].trackId : null;  // keep the playing track highlighted across reorders
  queue = list;
  qIndex = curId != null ? list.findIndex(t => t.trackId === curId) : -1;
  buildFavFilters();
  const filtered = !!(favFilterCC || favFilterGenre);
  // no dedicated "shuffle" button here — the top shuffle control already covers favorites.
  // when shuffled, show only a small chip to drop back to saved order.
  const ctrls = inner.querySelector("#fav-ctrls");
  if (ctrls){
    ctrls.innerHTML = shuffled
      ? '<button class="fav-mode on" id="fav-shuf-toggle" title="back to saved order">🔀 shuffled <span aria-hidden="true">✕</span></button>'
      : '';
    const t = inner.querySelector("#fav-shuf-toggle");
    if (t) t.onclick = () => renderFavorites("order");
  }
  const meta = inner.querySelector("#fav-meta");
  if (meta) meta.textContent = shuffled
    ? ("🔀 SHUFFLED · " + list.length + " TRACKS · ✕ TO EXIT")
    : (filtered ? (list.length + " OF " + favs.length + " · TAP TAGS TO FILTER") : (favs.length + " SAVED · TAP ♥ TO REMOVE"));
  if (!list.length){
    const tl = inner.querySelector("#tracklist");
    if (tl) tl.innerHTML = `<div class="empty">nothing matches<br>that filter… <em>tap the tag to clear</em></div>`;
    renderedList = list;
    return;
  }
  renderTracks(list);
}

// country + genre filter tags for the Favorites tab — only the ones present in the current favorites
function buildFavFilters(){
  const el = inner.querySelector("#fav-filters"); if (!el) return;
  const cc = {}, gc = {};
  favs.forEach(f => {
    if (f._cc && COUNTRIES[f._cc]) cc[f._cc] = (cc[f._cc] || 0) + 1;
    if (f.genre) gc[f.genre] = (gc[f.genre] || 0) + 1;
  });
  const countries = Object.entries(cc).sort((a, b) => b[1] - a[1]);
  const genres = Object.entries(gc).sort((a, b) => b[1] - a[1]);
  let html = "";
  if (countries.length > 1) html += `<div class="fav-frow"><span class="fav-frow__lbl">country →</span>` +
    countries.map(([code, n]) => `<button class="fav-tag${favFilterCC === code ? " on" : ""}" data-cc="${code}">${flagImg(code)}${esc(COUNTRIES[code].name)}<i>${n}</i></button>`).join("") + `</div>`;
  if (genres.length > 1) html += `<div class="fav-frow"><span class="fav-frow__lbl">genre →</span>` +
    genres.map(([g, n]) => `<button class="fav-tag${favFilterGenre === g ? " on" : ""}" data-genre="${esc(g)}">${esc(cap(g))}<i>${n}</i></button>`).join("") + `</div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-cc]").forEach(b => b.onclick = () => { favFilterCC = favFilterCC === b.dataset.cc ? null : b.dataset.cc; renderFavorites("order"); });
  el.querySelectorAll("[data-genre]").forEach(b => b.onclick = () => { favFilterGenre = favFilterGenre === b.dataset.genre ? null : b.dataset.genre; renderFavorites("order"); });
}

/* ---------- Mixtapes: auto-generated themed collections from a set of favorites ---------- */
// vibe families — each has an emoji, a subtitle, and a bank of playful names
const VIBES = {
  latenight: { emoji:"💔", sub:"for the small, aching hours", names:["3 A.M. & Heartbroken","Cry in Any Language","Slow Dance Alone","Blue Hour","Torch Songs"] },
  slowroast: { emoji:"☕", sub:"warm, unhurried, easy", names:["Sunday Slow Roast","Coffee & Vinyl","No Alarm Set","Golden Hour"] },
  dancefloor:{ emoji:"🔥", sub:"do not sit down", names:["Bodies on the Floor","Sweat Equity","Move or Leave","Speaker Damage","Last One Standing"] },
  windowsdown:{emoji:"🚗", sub:"loud, fast, sing it out", names:["Windows Down","Full Tank","Highway Hymns","Open Road"] },
  cypher:    { emoji:"🎤", sub:"heads down, bars up", names:["Corner Cypher","Head Nod Only","Bars & Breaks","Boom Bap"] },
  carnival:  { emoji:"🎉", sub:"hips don't ask permission", names:["Carnival Rules","Fiesta Forever","Fifth Wind","Fireworks"] },
  folkroots: { emoji:"🪕", sub:"strings, roots, and stories", names:["Roots & Wires","Old Souls","Handmade Sound","The Old Ways"] },
};
const GENRE_VIBE = {};
(function(){ const T = {
  latenight:["bolero","fado","tarab","chanson","desert blues","blues","laiko","rebetiko","andean","estrada","ballad","ranchera","tango","morna","enka","ghazal","qawwali"],
  slowroast:["jazz","bossa","bossa nova","soul","r&b","rnb","highlife","son","samba","mpb","neo-soul","lounge"],
  dancefloor:["afrobeats","afropop","reggaeton","soca","dancehall","house","dance","electronic","edm","kompa","mbalax","soukous","bongo-flava","amapiano","kuduro","dembow","techno","disco","funk","zouk","kizomba"],
  windowsdown:["rock","pop-rock","rock nacional","indie","pop","punk","new wave","synth-pop","britpop","v-pop","k-pop","j-pop","c-pop"],
  cypher:["hip-hop","rap","grime","drill","trap"],
  carnival:["calypso","salsa","merengue","cumbia","mande","bachata","vallenato","chicha","mariachi","norteño","banda"],
  folkroots:["folk","world","filmi","khaleeji","rai","fusión","fusion","gnawa","flamenco","celtic","country","reggae","mbaqanga"],
}; for (const v in T) T[v].forEach(g => { GENRE_VIBE[g] = v; }); })();
function vibeOf(t){
  const g = (t.genre||"").toLowerCase();
  if (GENRE_VIBE[g]) return GENRE_VIBE[g];
  for (const key in GENRE_VIBE){ if (g && (g.includes(key) || key.includes(g))) return GENRE_VIBE[key]; }
  return "folkroots";
}
const DEC_NAME = { "2020s":["Fresh Off the Press","Right Now","This Just In"], "now":["Fresh Off the Press","Right Now","Straight Off the Wire"],
  "2010s":["The Streaming Years","2010s Reboot"], "2000s":["Y2K Kids","The iPod Era","2000s Throwback"], "1990s":["The Cassette Years","'90s Forever"],
  "1980s":["Neon Nights","Big Hair Energy","'80s Reboot"], "1970s":["Disco Dust","'70s Gold"], "1960s":["Vinyl Crackle","The Swinging '60s"],
  "1950s":["Jukebox Era","Old School Cool"], "1940s":["Sepia Tone","The Wireless Years"], "pre1940s":["Wax Cylinder","Sepia Tone"] };
const DEC_SUB = { "2020s":"the newest of the new","now":"hot off the press","2010s":"the streaming decade","2000s":"burned to a CD-R","1990s":"rewind the tape","1980s":"neon and synths","1970s":"flares and grooves","1960s":"the crackle years","1950s":"jukebox gold","1940s":"static and swing","pre1940s":"from the wax" };

function mixShuf(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function mixHash(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;} return h>>>0; }
function mixPick(bank, seed){ return bank[mixHash(seed)%bank.length]; }
function mixAccent(m){
  if (m.kind==="country" && COUNTRIES[m.key]) return COUNTRIES[m.key].color;
  const VC = {latenight:"#8B77F8",slowroast:"#2AABCC",dancefloor:"#FF4D00",windowsdown:"#c8e64f",cypher:"#ff2e92",carnival:"#12a58c",folkroots:"#f4a08a"};
  if (m.kind==="vibe" && VC[m.key]) return VC[m.key];
  return ({passport:"#2AABCC",region:"#12a58c",diaspora:"#8B77F8",decade:"#FF4D00",crosscut:"#ff2e92",artist:"#c8e64f"})[m.kind] || "#ff2e92";
}
const MIN_SEEDS = 3, MAX_SEEDS = 6, REC_RATIO = 3;   // per mixtape: detect ≥3 saved seeds, fill 3 recs per seed

// flat catalog (every track + its country), built once — the recommendation pool
let CATALOG_FLAT = null;
function catalogFlat(){
  if (CATALOG_FLAT) return CATALOG_FLAT;
  CATALOG_FLAT = [];
  for (const cc in COUNTRIES){ const c=COUNTRIES[cc]; for (const e of Object.values(c.eras||{})) for (const t of e){ if (t.trackId!=null) CATALOG_FLAT.push(Object.assign({_cc:cc}, t)); } }
  return CATALOG_FLAT;
}
// given seed favorites + a pool predicate, recommend catalog tracks that CONTINUE the vibe (never already-saved)
function recommend(seeds, pred, favIds, n){
  if (n <= 0) return [];
  const prof = {cc:{}, dec:{}, gen:{}, art:{}};
  seeds.forEach(t => { if(t._cc)prof.cc[t._cc]=(prof.cc[t._cc]||0)+1; if(t.decade)prof.dec[t.decade]=(prof.dec[t.decade]||0)+1; if(t.genre)prof.gen[t.genre]=(prof.gen[t.genre]||0)+1; if(t.artist)prof.art[t.artist]=(prof.art[t.artist]||0)+1; });
  const scored = [];
  for (const t of catalogFlat()){
    if (favIds.has(String(t.trackId)) || !pred(t)) continue;
    // cohesion with the seed profile — same country/genre matters most, then decade; small jitter for freshness
    const s = 3*(prof.cc[t._cc]||0) + 2*(prof.gen[t.genre]||0) + 1*(prof.dec[t.decade]||0) + (prof.art[t.artist]?1.5:0) + Math.random()*2.5;
    scored.push([t, s]);
  }
  scored.sort((a,b) => b[1] - a[1]);
  const out = [], seen = new Set();
  for (const [t] of scored){ const id=String(t.trackId); if(seen.has(id))continue; seen.add(id);
    out.push(Object.assign({__rec:true}, t));   // clone + flag as a discovery pick (don't mutate the catalog)
    if (out.length >= n) break; }
  return out;
}
// weave seeds + recs at 1 saved : REC_RATIO recommended
function weave(seeds, recs){
  const out = []; let ri = 0;
  seeds.forEach(s => { out.push(s); for (let k=0;k<REC_RATIO && ri<recs.length;k++) out.push(recs[ri++]); });
  while (ri < recs.length) out.push(recs[ri++]);
  return out;
}

function buildMixtapes(src){
  const tracks = (src||[]).filter(t => t && t.trackId != null);
  if (tracks.length < MIN_SEEDS) return [];
  const favIds = new Set(tracks.map(t=>String(t.trackId)));
  const cands = [];
  const add = (kind, key, emoji, name, sub, list, pred) => {
    const seen = new Set(), uniq = [];
    list.forEach(t => { const id=String(t.trackId); if(!seen.has(id)){ seen.add(id); uniq.push(t); } });
    if (uniq.length < MIN_SEEDS) return;
    cands.push({ kind, key, emoji, name, sub, seeds: uniq, pred });
  };
  // vibe / mood
  const byVibe = {};
  tracks.forEach(t => { const v=vibeOf(t); (byVibe[v]=byVibe[v]||[]).push(t); });
  for (const v in byVibe){ const V=VIBES[v]; add("vibe", v, V.emoji, mixPick(V.names, v+byVibe[v].length), V.sub, byVibe[v], t => vibeOf(t)===v); }
  // geography — single-country deep dives
  const byCC = {};
  tracks.forEach(t => { if(t._cc && COUNTRIES[t._cc]) (byCC[t._cc]=byCC[t._cc]||[]).push(t); });
  const ccKeys = Object.keys(byCC);
  ccKeys.forEach(cc => { const n=COUNTRIES[cc].name;
    add("country", cc, "📍", mixPick([`One Night in ${n}`,`${n} After Dark`,`Deep in ${n}`,`${n} on Repeat`], cc+byCC[cc].length), `all roads lead to ${n}`, byCC[cc], t => t._cc===cc); });
  // musical region — a broader geo-cultural sweep across the shuffle REGIONS map (>=2 countries to qualify)
  const byReg = {};
  tracks.forEach(t => { const r = t._cc && CODE_REGION[t._cc]; if(r) (byReg[r]=byReg[r]||[]).push(t); });
  for (const r in byReg){ if (new Set(byReg[r].map(t=>t._cc)).size >= 2)
    add("region", r, "🗺", mixPick([`${r} After Dark`,`Deep in ${r}`,`The Sound of ${r}`,`Across ${r}`], r+byReg[r].length), `a sweep across ${r}`, byReg[r], t => t._cc && CODE_REGION[t._cc]===r); }
  // passport stamps — one from each country, round-robin
  if (ccKeys.length >= 4){
    const pools = ccKeys.map(cc => mixShuf(byCC[cc])), spread=[]; let added=true, r=0;
    while (added && spread.length < MAX_SEEDS*2){ added=false; pools.forEach(p => { if(p[r]){ spread.push(p[r]); added=true; } }); r++; }
    const ccSet = new Set(ccKeys);
    add("passport","world","🌍", mixPick(["Passport Stamps","No Layovers","Frequent Flyer","Customs Declaration"], "pp"+ccKeys.length), `${ccKeys.length} countries you love`, spread, t => ccSet.has(t._cc));
  }
  // diaspora
  add("diaspora","dia","🧭", mixPick(["Children of the Diaspora","Far From Home","Roots & Routes","The Long Way Home"], "dia"), "sounds carried across borders", tracks.filter(t=>t.diaspora), t => !!t.diaspora);
  // time — decades
  const byDec = {};
  tracks.forEach(t => { if(t.decade) (byDec[t.decade]=byDec[t.decade]||[]).push(t); });
  for (const d in byDec){ add("decade", d, "🕰", mixPick(DEC_NAME[d]||[cap(d)], d+byDec[d].length), DEC_SUB[d]||("the "+d+" on tape"), byDec[d], t => t.decade===d); }
  // cross-cut — heartbreak across languages
  const mel = byVibe.latenight||[]; const melCC = new Set(mel.map(t=>t._cc).filter(Boolean));
  if (mel.length >= MIN_SEEDS && melCC.size >= 3) add("crosscut","heartlang","🌧", `Heartbreak in ${melCC.size} Languages`, "the ache is universal", mel, t => vibeOf(t)==="latenight");
  // artist obsession → recommend more in that artist's lane (their dominant genre)
  const byArtist = {};
  tracks.forEach(t => { if(t.artist) (byArtist[t.artist]=byArtist[t.artist]||[]).push(t); });
  const top = Object.entries(byArtist).filter(([,l])=>l.length>=MIN_SEEDS).sort((a,b)=>b[1].length-a[1].length)[0];
  if (top){ const g = (top[1].find(t=>t.genre)||{}).genre;
    add("artist", top[0], "⭐", mixPick([`More Like ${top[0]}`,`The ${top[0]} Lane`,`If You Love ${top[0]}…`], top[0]), "more in this lane", top[1], t => g ? t.genre===g : t.artist===top[0]); }

  // rank + dedupe candidate CLUSTERS on their seed sets, then fill each with recommendations
  const kept = rankClusters(cands);
  return kept.map(c => {
    const seeds = mixShuf(c.seeds).slice(0, MAX_SEEDS);
    const recs = recommend(seeds, c.pred, favIds, seeds.length * REC_RATIO);
    return { kind:c.kind, key:c.key, emoji:c.emoji, name:c.name, sub:c.sub, id:c.kind+"_"+c.key,
             seedCount:seeds.length, recCount:recs.length, tracks: weave(seeds, recs) };
  }).filter(m => m.tracks.length >= 6);
}
function rankClusters(cands){
  const bonus = { passport:3, crosscut:3, region:2, vibe:2, diaspora:2, country:1, decade:1, artist:1 };
  cands.forEach(c => c._score = c.seeds.length + (bonus[c.kind]||0)*2);
  cands.sort((a,b) => b._score - a._score);
  const kept = [], idset = c => new Set(c.seeds.map(t=>String(t.trackId)));
  for (const c of cands){
    const cs = idset(c); let dup=false;
    for (const k of kept){ const ks=idset(k); let inter=0; cs.forEach(id=>{if(ks.has(id))inter++;});
      // symmetric Jaccard so a small cluster nested inside a big one (e.g. a country inside a decade)
      // survives as its own discovery angle — only near-identical clusters are dropped
      if (inter/(cs.size + ks.size - inter) > 0.6){ dup=true; break; } }
    if (!dup) kept.push(c);
    if (kept.length >= 8) break;
  }
  return kept;
}

// ---- Mixtapes UI ----
let currentMixes = [], viewingMix = null, shufMix = null;   // shufMix → top shuffle scopes to the open mixtape
function mixCollage(tracks){
  const covers = tracks.map(t=>t.cover).filter(Boolean).slice(0,4);
  while (covers.length < 4) covers.push(null);
  return `<span class="mix-cov">${covers.map(c => c ? `<img loading="lazy" src="${esc(c)}" alt="">` : `<span class="mix-cov__x"></span>`).join("")}</span>`;
}
function renderMixStrip(){
  const el = inner.querySelector("#mixtapes"); if (!el) return;
  currentMixes = buildMixtapes(favs);
  if (!currentMixes.length){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="mix-head"><span class="mix-head__t">🎧 Your Mixtapes</span><span class="mix-head__s">auto-mixed from your favorites — tap to play, share to send</span></div>
    <div class="mix-row">${currentMixes.map((m,i)=>`
      <button class="mix-card" data-i="${i}" style="--accent:${mixAccent(m)}">
        ${mixCollage(m.tracks)}
        <span class="mix-card__body"><span class="mix-card__name">${m.emoji} ${esc(m.name)}</span>
        <span class="mix-card__sub">${esc(m.sub)}</span>
        <span class="mix-card__ct">${m.tracks.length} tracks${m.recCount?` · ${m.recCount} new`:``} →</span></span>
      </button>`).join("")}</div>`;
  el.querySelectorAll(".mix-card").forEach(b => b.onclick = () => openMixtape(currentMixes[+b.dataset.i]));
}
function openMixtape(m){
  viewingMix = m; activeCode = null; currentEra = null; currentGenre = null;
  const shared = !!m.shared, acc = mixAccent(m);
  inner.innerHTML = `<div class="jhead jhead--mix">
    <button class="mix-back" id="mix-back">${shared ? "‹ explore the map" : "‹ favorites"}</button>
    <div class="jhead__top"><div class="jhead__flag jhead__flag--ico" style="--accent:${acc}">${m.emoji||"🎧"}</div>
      <h2 class="jhead__name" style="--accent:${acc}">${esc(m.name)}</h2></div>
    <div class="jhead__meta">${esc((m.sub||"").toUpperCase())} · ${m.recCount ? (m.seedCount+" SAVED + "+m.recCount+" NEW") : (m.tracks.length+" TRACKS")}${shared && m.by ? " · FROM "+esc((m.by||"").toUpperCase()) : ""}</div>
    ${m.recCount ? `<div class="mix-hint">✦ fresh picks matched to your taste — heart the keepers to save them</div>` : ``}
    <div class="mix-actions">
      <button class="mix-btn mix-btn--play" id="mix-play">▶ Play</button>
      <button class="mix-btn" id="mix-shuf">🔀 Shuffle</button>
      ${shared ? `<button class="mix-btn" id="mix-save">♥ Save these</button>` : ``}
      <button class="mix-btn mix-btn--share" id="mix-share">✈️ Share</button>
    </div></div>
    <div id="tracklist"></div>`;
  const back = inner.querySelector("#mix-back");
  back.onclick = () => { viewingMix=null; if (shared) backToMap(); else openFavorites(); };
  // renderTracks only paints the DOM — the queue must be set alongside it so row-clicks/Play scope to THIS mixtape
  const showList = list => { queue = list; qIndex = -1; renderTracks(list); };
  inner.querySelector("#mix-play").onclick = () => { showList(m.tracks); play(0); };
  inner.querySelector("#mix-shuf").onclick = () => { showList(mixShuf(m.tracks)); play(0); };
  inner.querySelector("#mix-share").onclick = () => shareMixtape(m);
  const sv = inner.querySelector("#mix-save");
  if (sv) sv.onclick = () => { let n=0; m.tracks.forEach(t => { if(!isFav(t.trackId)){ toggleFav(t, t._cc); n++; } }); refreshFavHearts(); flashToast(n ? (n+" track"+(n>1?"s":"")+" saved to your favorites ♥") : "already in your favorites"); };
  showList(m.tracks);
  setShufMix(m);   // top shuffle now reflects + shuffles within this mixtape
}
// point the top shuffle control at the open mixtape (no dropdown option — set scope directly)
function setShufMix(m){
  shufMix = m;
  const rs=document.getElementById("f-region"), cs=document.getElementById("f-country"),
        es=document.getElementById("f-era"), gs=document.getElementById("f-genre");
  if (cs){ rs.value=""; cs.value=""; es.value=""; gs.value=""; }
  shuf = { region:"", country:"__mix", era:"", genre:"" };
  updateScope();
}
async function shareMixtape(m){
  if (!(FB && authUser)){ flashToast("sign in to share your mixtape"); if (window.signInGoogle) window.signInGoogle(); return; }
  try {
    flashToast("creating share link…");
    const rec = { name:(m.name||"Mixtape").slice(0,80), sub:(m.sub||"").slice(0,120), emoji:m.emoji||"🎧", kind:m.kind||"mix",
      by: authUser.displayName || "", uid: authUser.uid,
      tracks: m.tracks.slice(0,30).map(t => favRecord(t, t._cc)),
      createdAt: FB.firestore.FieldValue.serverTimestamp() };
    const ref = await FB.firestore().collection("mixes").add(rec);
    const url = location.origin + location.pathname + "?m=" + ref.id;
    if (navigator.share){ try { await navigator.share({ title:m.name, text:`${m.emoji||"🎧"} ${m.name} — a World Mixtape`, url }); } catch(_){} }
    else { try { await navigator.clipboard.writeText(url); flashToast("link copied — paste it anywhere 🔗"); } catch(_){ prompt("Copy your mixtape link:", url); } }
  } catch(e){ console.warn("share", e); flashToast("couldn't create link: " + (e.code||"error")); }
}
async function loadSharedMix(id){
  if (!FB){ flashToast("sharing needs a connection"); return; }
  try {
    const doc = await FB.firestore().collection("mixes").doc(id).get();
    if (!doc.exists){ flashToast("that mixtape link isn't valid"); return; }
    const d = doc.data();
    openMixtape({ id, name:d.name, sub:d.sub, emoji:d.emoji, kind:d.kind, key:d.kind, by:d.by, tracks:(d.tracks||[]), shared:true });
    openPanel();
  } catch(e){ console.warn("load shared", e); flashToast("couldn't load that mixtape"); }
}

function onCountry(e, d) {
  const code = isoToCode[+d.id];
  d3.selectAll("path.country").classed("active", false);
  if (code) { gMap.selectAll("path.country").filter(x => isoToCode[+x.id] === code).classed("active", true); openCountry(code); }
  else openEmpty(nameOf(d));
  openPanel();
}

function openPanel(){ panel.classList.add("show"); scrim.classList.add("show"); document.body.classList.add("panel-open"); panel.setAttribute("aria-hidden","false"); }
function closePanel(){ panel.classList.remove("show"); scrim.classList.remove("show"); document.body.classList.remove("panel-open"); panel.setAttribute("aria-hidden","true"); d3.selectAll("path.country").classed("active", false); }
function backToMap(){ closePanel(); setShuf(""); }   // leaving for the map resets shuffle scope to the world
document.getElementById("panel-close").onclick = backToMap;
scrim.onclick = backToMap;

function openEmpty(name){
  activeCode = null; queue = []; qIndex = -1;
  inner.innerHTML = `<div class="jhead"><div class="jhead__top"><div class="jhead__flag">📻</div>
    <h2 class="jhead__name" style="--accent:var(--yellow)">${name}</h2></div></div>
    <div class="empty">no mixtape here… <em>yet</em><small>this prototype carries ${Object.keys(COUNTRIES).length} countries. ${name} is on deck.</small></div>`;
  setShuf("");
}

// fixed temporal axis (Radiooooo-style). [dataKey, label]
const ERAS = [["now","NOW"],["2020s","2020s"],["2010s","2010s"],["2000s","2000s"],["1990s","90s"],
              ["1980s","80s"],["1970s","70s"],["1960s","60s"],["1950s","50s"],["1940s","40s"],["pre1940s","PRE-40s"]];
const ERA_LABEL = { now:"RIGHT NOW", "2020s":"the 2020s", "2010s":"the 2010s", "2000s":"the 2000s",
  "1990s":"the 1990s", "1980s":"the 1980s", "1970s":"the 1970s", "1960s":"the 1960s", "1950s":"the 1950s",
  "1940s":"the 1940s", "pre1940s":"before the 1940s" };

function openCountry(code){
  activeCode = code; currentEra = "now"; currentGenre = null;
  const c = COUNTRIES[code];
  document.documentElement.style.setProperty("--accent", c.color);

  const eraBar = `<div class="eras" id="eras">` + ERAS.map(([k,lbl]) => {
    const has = c.eras[k] && c.eras[k].length;
    return `<button class="era${k==="now"?" era--now":""}${has?"":" era--empty"}" data-era="${k}">${lbl}</button>`;
  }).join("") + `</div>`;

  // genre bar — country's own genres + counts, across the whole catalog
  const gc = {};
  Object.values(c.eras).flat().forEach(t => { if (t.genre) gc[t.genre] = (gc[t.genre]||0)+1; });
  const genres = Object.entries(gc).sort((a,b)=>b[1]-a[1]);
  const genreBar = genres.length ? `<div class="genres" id="genres"><span class="genres__lbl">dig by genre →</span>` +
    genres.map(([g,n]) => `<button class="genre" data-genre="${esc(g)}">${esc(g)}<i>${n}</i></button>`).join("") + `</div>` : "";

  const hasInfo = !!COUNTRY_INFO[code];
  inner.innerHTML = `
    <div class="jhead">
      <div class="jhead__top${hasInfo ? " jhead__top--info" : ""}"${hasInfo ? ` id="jhead-info" role="button" tabindex="0" title="Country info" aria-label="Open ${esc(c.name)} country info"` : ""}>
        <div class="jhead__flag">${flagImg(code)}</div>
        <h2 class="jhead__name" style="--accent:${c.color}">${c.name}${WC2026.has(code) ? '<span class="wc-ball" title="2026 World Cup team" aria-label="2026 World Cup team">⚽</span>' : ''}</h2>
        ${hasInfo ? '<span class="jhead__info" aria-hidden="true">i</span>' : ''}
      </div>
      <div class="jhead__meta" id="jmeta"></div>
    </div>
    ${eraBar}
    ${genreBar}
    <div id="tracklist"></div>`;

  if (hasInfo){
    const ji = inner.querySelector("#jhead-info");
    ji.onclick = () => openInfo(code);
    ji.onkeydown = e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); openInfo(code); } };
  }
  inner.querySelectorAll(".era").forEach(b => b.onclick = () => renderEra(b.dataset.era));
  inner.querySelectorAll(".genre").forEach(b => b.onclick = () => renderGenre(b.dataset.genre));
  renderEra("now");
  setShuf(code);   // shuffle is now pre-filtered to this country
}

function renderTracks(list){
  const tl = inner.querySelector("#tracklist");
  if (!tl.dataset.hs){ tl.dataset.hs = "1";   // collapse the header once the list is scrolled
    tl.addEventListener("scroll", () => panel.classList.toggle("scrolled", tl.scrollTop > 8), { passive: true });
  }
  renderedList = list;
  const accOf = t => (t._cc && COUNTRIES[t._cc] ? COUNTRIES[t._cc].color
    : (activeCode && COUNTRIES[activeCode] ? COUNTRIES[activeCode].color : "#ff2e92"));
  tl.innerHTML = list.map((t, i) => `
    <div class="track" data-i="${i}" style="animation-delay:${Math.min(i,30)*0.03}s;--accent:${accOf(t)}">
      <div class="track__rank">${i+1}${t.year?`<span class="track__yr">${t.year}</span>`:''}</div>
      <img class="track__art" loading="lazy" src="${t.cover||''}" alt="">
      <div class="track__txt">
        <div class="track__title">${esc(t.title)}${t.__rec?'<span class="track__new" title="A discovery pick matched to your taste — heart it to save"><span class="track__new-star">✦</span> new</span>':''}${(!t.ytId)?'<span class="track__30s" title="Preview only — full song not available; 30-second clip">30s</span>':''}</div>
        <div class="track__artist">${esc(t.artist)}${t.diaspora?'<span class="track__nf">diáspora</span>':''}</div>
      </div>
      <div class="track__actions">
        <span class="track__ct" data-i="${i}" title="times hearted" hidden></span>
        <button class="track__fav${isFav(t.trackId)?" on":""}" data-i="${i}" data-id="${t.trackId}" aria-label="Save to favorites">♥</button>
        <button class="track__play" aria-label="Play">▶</button>
      </div>
    </div>`).join("");
  paintTrackCounts(list, tl);   // paint any cached counts immediately, then fetch the rest
  fillTrackCounts(list, tl);
  tl.querySelectorAll(".track").forEach(el => el.onclick = () => play(+el.dataset.i));
  tl.querySelectorAll(".track__fav").forEach(el => el.onclick = e => {
    e.stopPropagation(); toggleFav(list[+el.dataset.i], activeCode); refreshFavHearts();
  });
  tl.querySelectorAll(".track").forEach(el => {   // hover → ticker any cut-off title/artist
    el.addEventListener("mouseenter", () => { hoverMq(el.querySelector(".track__title"), true); hoverMq(el.querySelector(".track__artist"), true); });
    el.addEventListener("mouseleave", () => { hoverMq(el.querySelector(".track__title"), false); hoverMq(el.querySelector(".track__artist"), false); });
  });
  tl.scrollTop = 0; panel.classList.remove("scrolled");   // a new list starts at the top with the header expanded
  highlightRow();
}

function clearShuffleChip(){   // leave the in-country shuffle view
  const e = inner.querySelector("#eras");
  if (e){ e.classList.remove("shuffling"); const c = e.querySelector("#shuf-chip"); if (c) c.remove(); }
}

function renderEra(key){
  clearShuffleChip();
  currentEra = key; currentGenre = null;
  const c = COUNTRIES[activeCode];
  const list = (c.eras[key] || []).slice().sort((a,b) => (a.year||0)-(b.year||0)); // chronological within the decade
  queue = list; qIndex = -1;                 // player queue follows the visible era
  inner.querySelectorAll(".era").forEach(b => b.classList.toggle("active", b.dataset.era === key));
  inner.querySelectorAll(".genre").forEach(b => b.classList.remove("active"));
  const meta = inner.querySelector("#jmeta");
  if (meta) meta.textContent = "";   // era/natives line removed for a cleaner header (era is already shown by the active tag)

  if (!list.length){
    inner.querySelector("#tracklist").innerHTML = `<div class="empty">no crate for<br>${c.name} · ${ERA_LABEL[key]}… <em>yet</em>
      <small>each decade is curated by hand. crate-digging the rest is next.</small></div>`;
    return;
  }
  renderTracks(list);
}

function renderGenre(g){
  clearShuffleChip();
  currentGenre = g; currentEra = null;
  const c = COUNTRIES[activeCode];
  const list = Object.values(c.eras).flat().filter(t => t.genre === g).sort((a,b)=>(a.year||0)-(b.year||0));
  queue = list; qIndex = -1;
  inner.querySelectorAll(".era").forEach(b => b.classList.remove("active"));
  inner.querySelectorAll(".genre").forEach(b => b.classList.toggle("active", b.dataset.genre === g));
  const meta = inner.querySelector("#jmeta");
  if (meta) meta.textContent = "";   // genre count already shown on the genre tag badge
  renderTracks(list);
}

const esc = s => (s||"").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/* ---------- shuffle the world (with country / musical-region / era / genre filters) ---------- */
const cap = g => g.replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// musical regions — countries grouped by shared musical DNA (not geography). Each country in one region.
const REGIONS = {
  "North America": ["US","CA"],
  "Mexico & Central America": ["MX","GT","HN","SV","NI","CR"],
  "Spanish Caribbean & Afro-Latin": ["CU","DO","PR","PA","VE","CO"],
  "Creole Caribbean": ["JM","TT","BB","HT","CW","SR","AG","BS","BZ","DM","GD","GY","KN","LC","VC"],
  "The Andes": ["PE","BO","EC"],
  "Southern Cone": ["AR","UY","CL","PY"],
  "Lusophone Atlantic": ["PT","BR","AO","CV","MZ","GW","ST"],
  "British Isles": ["GB","IE"],
  "Nordic": ["SE","NO","DK","FI","IS","GL"],
  "Western Europe": ["FR","DE","AT","CH","NL","BE","LU","LI","MC"],
  "Iberia & Mediterranean": ["ES","IT","GR","AD","MT","SM","VA"],
  "The Balkans": ["RS","BA","HR","SI","BG","RO","AL","MK","ME","XK"],
  "Eastern Europe & Baltics": ["PL","CZ","SK","HU","UA","BY","RU","MD","LT","LV","EE"],
  "Maghreb": ["DZ","MA","TN","LY","EH"],
  "Levant & Eastern Mediterranean": ["EG","LB","SY","JO","PS","IQ","IL","CY"],
  "Arabian Gulf": ["SA","KW","AE","QA","OM","BH","YE"],
  "West Africa": ["NG","GH","SN","ML","GN","CI","BJ","NE","BF","TG","SL","GM","LR","MR"],
  "Central Africa": ["CD","CM","CF","TD","GA","CG","GQ"],
  "East Africa": ["KE","TZ","UG","RW","BI","SS"],
  "Horn of Africa": ["ET","SO","ER","DJ","SD","XG"],
  "Southern Africa": ["ZA","ZW","ZM","MG","BW","NA","LS","SZ","MW"],
  "Indian Ocean": ["MU","RE","SC","KM","MV"],
  "Anatolia & Caucasus": ["TR","AM","AZ","GE"],
  "Persia & the Steppe": ["IR","UZ","KZ","MN","AF","TM","KG","TJ"],
  "South Asia": ["IN","PK","BD","NP","LK","BT"],
  "Southeast Asia": ["ID","MY","PH","TH","VN","KH","MM","LA","BN","SG","TL"],
  "East Asia": ["CN","TW","JP","KR","KP"],
  "Pacific Islands": ["FJ","PG","WS","TO","SB","VU","KI","TV","FM","NC"],
  "Oceania": ["AU","NZ"],
};
const CODE_REGION = {};   // country code -> region name
Object.entries(REGIONS).forEach(([r, codes]) => codes.forEach(code => { CODE_REGION[code] = r; }));

let shuf = { country: "", region: "", era: "", genre: "" };

// tagged track pool + full option lists — powers the faceted (cascading) shuffle filters
const SHUF_INDEX = [];
const _gset = new Set();
Object.entries(COUNTRIES).forEach(([code, c]) => {
  const region = CODE_REGION[code];
  Object.entries(c.eras).forEach(([era, list]) => {
    list.forEach(t => { SHUF_INDEX.push({ code, region, era, genre: t.genre }); if (t.genre) _gset.add(t.genre); });
  });
});
const SHUF_COUNTRIES = Object.entries(COUNTRIES).map(([code, c]) => [code, c.name]).sort((a, b) => a[1].localeCompare(b[1]));
const SHUF_GENRES = [..._gset].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
const SHUF_REGIONS = Object.keys(REGIONS);   // grouped insertion order

function shufOptionsHTML(kind, valid){
  if (kind === "region") return '<option value="">🌐 any region</option>' + SHUF_REGIONS.filter(r => valid.has(r)).map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
  if (kind === "country") return '<option value="">🌍 everywhere</option>' + (favs.length ? '<option value="__favs">♥ my favorites</option>' : '') + SHUF_COUNTRIES.filter(([code]) => valid.has(code)).map(([code, n]) => `<option value="${code}">${esc(n)}</option>`).join("");
  if (kind === "era") return '<option value="">all eras</option>' + ERAS.filter(([k]) => valid.has(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  return '<option value="">all genres</option>' + SHUF_GENRES.filter(g => valid.has(g)).map(g => `<option value="${esc(g)}">${esc(cap(g))}</option>`).join("");
}

// after any pick, rebuild every menu to only the values that still have matches given the OTHER picks
function applyShufFacets(){
  const rs = document.getElementById("f-region"), cs = document.getElementById("f-country"), es = document.getElementById("f-era"), gs = document.getElementById("f-genre");
  if (!rs) return;
  const sel = { region: rs.value, country: cs.value, era: es.value, genre: gs.value };
  let R, C, E, G;
  if (sel.country === "__favs"){   // favorites is a personal set — don't cascade-limit the other menus
    R = new Set(SHUF_REGIONS); C = new Set(SHUF_COUNTRIES.map(x => x[0])); E = new Set(ERAS.map(x => x[0])); G = new Set(SHUF_GENRES);
  } else {
    const ok = (t, skip) =>
      (skip === "region" || !sel.region || t.region === sel.region) &&
      (skip === "country" || !sel.country || t.code === sel.country) &&
      (skip === "era" || !sel.era || t.era === sel.era) &&
      (skip === "genre" || !sel.genre || t.genre === sel.genre);
    R = new Set(); C = new Set(); E = new Set(); G = new Set();
    for (const t of SHUF_INDEX){
      if (ok(t, "region")) R.add(t.region);
      if (ok(t, "country")) C.add(t.code);
      if (ok(t, "era")) E.add(t.era);
      if (ok(t, "genre") && t.genre) G.add(t.genre);
    }
  }
  rs.innerHTML = shufOptionsHTML("region", R);  rs.value = sel.region;
  cs.innerHTML = shufOptionsHTML("country", C); cs.value = sel.country;
  es.innerHTML = shufOptionsHTML("era", E);     es.value = sel.era;
  gs.innerHTML = shufOptionsHTML("genre", G);   gs.value = sel.genre;
  shuf = { region: rs.value, country: cs.value, era: es.value, genre: gs.value };   // re-read (a dropped value falls back to "all")
  updateScope();
  const empty = document.getElementById("f-empty"); if (empty) empty.hidden = true;
}

(function initShufflePop(){
  const pop = document.getElementById("shuffle-pop");
  if (!pop) return;
  pop.innerHTML = `
    <h4>shuffle…</h4>
    <div><label>region</label><select id="f-region"></select></div>
    <div><label>country</label><select id="f-country"></select></div>
    <div><label>when</label><select id="f-era"></select></div>
    <div><label>what</label><select id="f-genre"></select></div>
    <button class="shuffle-go" id="f-go">▶ shuffle these</button>
    <button class="shuffle-reset" id="f-reset">reset filters</button>
    <div class="shuffle-empty" id="f-empty" hidden>no tracks for that combo</div>`;
  const rs = document.getElementById("f-region"), cs = document.getElementById("f-country"), es = document.getElementById("f-era"), gs = document.getElementById("f-genre");
  rs.onchange = cs.onchange = es.onchange = gs.onchange = applyShufFacets;
  document.getElementById("f-go").onclick = () => doShuffle();
  document.getElementById("f-reset").onclick = () => { rs.value = cs.value = es.value = gs.value = ""; applyShufFacets(); };
  applyShufFacets();   // initial populate (everything valid)
})();

function updateScope(){
  const parts = [];
  if (shuf.country === "__mix") parts.push(shufMix ? shufMix.name : "this mixtape");
  else if (shuf.country === "__favs") parts.push("favorites");
  else if (shuf.country) parts.push(COUNTRIES[shuf.country].name);
  else if (shuf.region) parts.push(shuf.region);
  if (shuf.era) parts.push((ERAS.find(e => e[0] === shuf.era) || [])[1]);
  if (shuf.genre) parts.push(cap(shuf.genre));
  document.getElementById("shuffle-scope").textContent = parts.length ? parts.join(" · ") : "the world";
  document.getElementById("shuffle-filt").classList.toggle("on", parts.length > 0);
}

// pre-filter the shuffle scope to what's on screen (country / favorites / world) — resets other facets
function setShuf(country){
  shufMix = null;   // any explicit scope change drops the mixtape scope
  const rs = document.getElementById("f-region"), cs = document.getElementById("f-country"),
        es = document.getElementById("f-era"), gs = document.getElementById("f-genre");
  if (cs){
    rs.value = ""; es.value = ""; gs.value = ""; cs.value = "";
    applyShufFacets();               // rebuild the option lists first (adds "__favs" once there are favorites)
    cs.value = country || "";        // now the desired option exists, so the assignment sticks
    applyShufFacets();               // re-apply with it selected → updates shuf scope + label
  }
  else { shuf = { country: country || "", region: "", era: "", genre: "" }; updateScope(); }
}

function doShuffle(){
  const all = [];
  if (shuf.country === "__mix"){
    (shufMix && shufMix.tracks || []).forEach(t => all.push(Object.assign({}, t)));
  } else if (shuf.country === "__favs"){
    favs.forEach(t => {
      if (shuf.region && CODE_REGION[t._cc] !== shuf.region) return;
      if (shuf.era && t.decade !== shuf.era) return;
      if (shuf.genre && t.genre !== shuf.genre) return;
      all.push(Object.assign({}, t));
    });
  } else {
    Object.entries(COUNTRIES).forEach(([code, c]) => {
      if (shuf.country && code !== shuf.country) return;
      if (shuf.region && CODE_REGION[code] !== shuf.region) return;
      Object.entries(c.eras).forEach(([ek, list]) => {
        if (shuf.era && ek !== shuf.era) return;
        list.forEach(t => { if (shuf.genre && t.genre !== shuf.genre) return; all.push(Object.assign({ _cc: code }, t)); });
      });
    });
  }
  const emptyEl = document.getElementById("f-empty");
  if (!all.length){ if (emptyEl) emptyEl.hidden = false; togglePop(true); return; }
  if (emptyEl) emptyEl.hidden = true;
  for (let i = all.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  togglePop(false);
  queue = all; qIndex = -1;
  const scoped = !!shuf.country;   // a country, favorites, or a mixtape is selected → stay put
  if (scoped && panel.classList.contains("show") && inner.querySelector("#tracklist")){
    if (shuf.country === "__mix" && viewingMix){   // mixtape view → shuffle within the mixtape in place
      const meta = inner.querySelector(".jhead--mix .jhead__meta");
      if (meta) meta.textContent = "🔀 SHUFFLED · " + all.length + " TRACKS";
      renderTracks(all);
      if (all.length) play(0);
      return;
    }
    if (inner.querySelector("#fav-ctrls")){   // favorites view → shuffle the playlist in place
      renderFavorites("shuffle");
      if (queue.length) play(0);
      return;
    }
    // stay in the open panel and show the shuffle there (highlights as it plays)
    inner.querySelectorAll(".genre").forEach(b => b.classList.remove("active"));
    const erasEl = inner.querySelector("#eras");
    if (erasEl){
      erasEl.querySelectorAll(".era").forEach(b => b.classList.remove("active"));
      erasEl.classList.add("shuffling");                 // dims the decades so none looks selected
      if (!erasEl.querySelector("#shuf-chip")){
        const chip = document.createElement("button");
        chip.id = "shuf-chip"; chip.className = "era era--shuf active";
        chip.innerHTML = '🔀 shuffle <span aria-hidden="true">✕</span>';
        chip.title = "exit shuffle";
        chip.onclick = () => renderEra(currentEra && COUNTRIES[activeCode] && COUNTRIES[activeCode].eras[currentEra] ? currentEra : "now");
        erasEl.prepend(chip); chip.scrollIntoView({ inline: "start", block: "nearest" });
      }
    }
    const meta = inner.querySelector("#jmeta");
    if (meta) meta.textContent = "🔀 SHUFFLED · " + all.length + " TRACKS · ✕ TO EXIT";
    renderTracks(all);
  } else {
    // global world shuffle → open a panel with the shuffled queue as a scrollable playlist.
    // CAP the queue: rendering 16k+ track rows (each with an <img>) freezes/crashes the browser.
    const pool = all.length;
    if (all.length > 250) all.length = 250;
    queue = all;
    activeCode = null; currentEra = null; currentGenre = null;
    const scopeTxt = (document.getElementById("shuffle-scope").textContent || "the world");
    const countTxt = pool > all.length ? `${all.length} OF ${pool.toLocaleString()} TRACKS` : `${all.length} TRACKS`;
    inner.innerHTML = `<div class="jhead"><div class="jhead__top">` +
      `<div class="jhead__flag jhead__flag--ico" style="color:var(--lime)">🔀</div>` +
      `<h2 class="jhead__name" style="--accent:var(--lime)">Shuffle</h2></div>` +
      `<div class="jhead__meta" id="jmeta">🔀 ${esc(scopeTxt.toUpperCase())} · ${countTxt}</div></div>` +
      `<div id="tracklist"></div>`;
    renderTracks(all);
    openPanel();
  }
  play(0);
}

function togglePop(force){
  const pop = document.getElementById("shuffle-pop"), filt = document.getElementById("shuffle-filt");
  const show = force !== undefined ? force : pop.hidden;
  pop.hidden = !show; filt.classList.toggle("open", show); filt.setAttribute("aria-expanded", show);
}

const shuffleBtn = document.getElementById("shuffle");
if (shuffleBtn) shuffleBtn.onclick = () => {
  shuffleBtn.classList.remove("spinning"); void shuffleBtn.offsetWidth; shuffleBtn.classList.add("spinning");
  setTimeout(() => shuffleBtn.classList.remove("spinning"), 600);
  doShuffle();
};
document.getElementById("shuffle-filt").onclick = () => togglePop();
document.addEventListener("click", e => {
  const wrap = document.getElementById("shuffle-wrap"), pop = document.getElementById("shuffle-pop");
  if (!pop.hidden && !wrap.contains(e.target) && !pop.contains(e.target)) togglePop(false);
});

/* ---------- player ---------- */
const audio = document.getElementById("audio");
const player = document.getElementById("player");
let jsonpN = 0;

function dzTrack(id, cb){
  const name = "__dz" + (jsonpN++);
  const s = document.createElement("script");
  window[name] = data => { try{ delete window[name]; }catch(_){window[name]=null;} s.remove(); cb(data); };
  s.onerror = () => { cb(null); s.remove(); };
  s.src = `https://api.deezer.com/track/${id}?output=jsonp&callback=${name}`;
  document.body.appendChild(s);
}

// marquee an element on demand (used on row hover) — only if its text is cut off
function hoverMq(el, on){
  if (!el) return;
  if (on){
    if (el.dataset.mq != null) return;
    if (el.scrollWidth <= el.clientWidth + 4) return;     // fits → leave it
    el.dataset.mq = el.innerHTML;
    el.style.setProperty("--mq-dur", Math.max(6, Math.round(el.scrollWidth / 26)) + "s");
    el.innerHTML = '<span class="mq-track"><span class="mq-seg">' + el.dataset.mq + '</span><span class="mq-seg" aria-hidden="true">' + el.dataset.mq + '</span></span>';
    el.classList.add("mq");
  } else {
    if (el.dataset.mq == null) return;
    el.classList.remove("mq");
    el.innerHTML = el.dataset.mq;
    delete el.dataset.mq;
    el.style.removeProperty("--mq-dur");
  }
}

// set player title/artist; gently marquee the line only when it overflows
function setMeta(el, html){
  el.classList.remove("mq");
  el.innerHTML = html;
  const w = el.scrollWidth;
  if (w > el.clientWidth + 4){
    el.style.setProperty("--mq-dur", Math.max(9, Math.round(w / 26)) + "s");
    el.innerHTML = '<span class="mq-track"><span class="mq-seg">' + html + '</span><span class="mq-seg" aria-hidden="true">' + html + '</span></span>';
    el.classList.add("mq");
  }
}

// shared "artist · 🏳 country · year · Genre" line — used by the play bar and the expanded art view
function trackMetaHtml(t, cc){
  return esc(t.artist)
    + (cc ? " · " + flagImg(cc) + " " + esc(COUNTRIES[cc].name) : "")
    + (t.year ? " · " + t.year : "")
    + (t.genre ? " · " + esc(t.genre.replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())) : "");
}

/* ---------- play tracking → Cloud Function (per-song + total; fire-and-forget, ≥5s = a real play) ---------- */
const PLAY_LOG_URL = "https://us-central1-world-mix-tape.cloudfunctions.net/logPlay";
let _playLogT = null;
function schedulePlayLog(trackId){
  clearTimeout(_playLogT);
  if (trackId == null) return;
  _playLogT = setTimeout(() => {
    try { fetch(PLAY_LOG_URL + "?t=" + encodeURIComponent(trackId), { method: "POST", keepalive: true }).catch(() => {}); } catch (_){}
  }, 5000);   // skips (<5s) don't count
}

async function play(i){
  if (!queue.length) return;
  qIndex = (i + queue.length) % queue.length;
  const t = queue[qIndex];
  if (!t.ytId) hydrateFav(t);   // favorites saved pre-full-song → pull the ytId from the live catalog
  schedulePlayLog(t.trackId);   // count this play if it lasts ≥5s
  const cc = t._cc || activeCode;
  player.classList.add("show"); player.setAttribute("aria-hidden","false");
  document.getElementById("p-art").src = t.cover || "";
  currentNote = null;   // new track → drop any pending Spotify-note restore
  setMeta(document.getElementById("p-title"), esc(t.title));
  setMeta(document.getElementById("p-artist"), trackMetaHtml(t, cc));
  setProg("0%");
  setPlayIcon(true); player.classList.add("playing");
  // world-shuffle: light up the track's country on the map as it plays
  if (t._cc){
    d3.selectAll("path.country").classed("active", false);
    gMap.selectAll("path.country").filter(x => isoToCode[+x.id] === t._cc).classed("active", true);
  }
  highlightRow();
  refreshFavHearts();
  if (artModal && !artModal.hidden) renderArtModal();   // keep the expanded card in sync as tracks change

  // Tracks carrying a ytId play full-length in-browser via YouTube, no login, for everyone.
  // On embed error they fall through to the 30s preview (see onYtError). Tracks with no ytId
  // (no full version found) play the 30s Deezer/iTunes preview below.
  if (t.ytId && ytReady && !ytFailed.has(t.ytId)){
    audio.pause();
    playSource = "youtube"; ytExpected = t.ytId; curDuration = 0;
    yt.loadVideoById(t.ytId);
    if (yt.playVideo) yt.playVideo();
    startYtPoll();
    return;
  }

  stopYt();
  playSource = "preview";
  const onUrl = url => {
    if (queue[qIndex] !== t) return;
    if (!url){ document.getElementById("p-artist").textContent = "preview unavailable — skipping…"; setTimeout(next, 900); return; }
    audio.src = url;
    audio.play().catch(()=>{ setPlayIcon(false); player.classList.remove("playing"); });
  };
  if (t.src === "itunes" && t.preview) onUrl(t.preview);            // iTunes-sourced backfill track → its stored preview
  else dzTrack(t.trackId, data => onUrl(data && data.preview));    // Deezer track → fresh 30s JSONP preview
}

function setPlayIcon(playing){
  document.getElementById("p-play").textContent = playing ? "❚❚" : "▶";
  const ap = document.getElementById("art-play"); if (ap) ap.textContent = playing ? "❚❚" : "▶";
}

function togglePlay(){
  if (qIndex < 0){ if (queue.length) play(0); return; }
  if (playSource === "youtube"){
    if (!yt) return;
    if (yt.getPlayerState() === YT.PlayerState.PLAYING) yt.pauseVideo(); else yt.playVideo();
    return;
  }
  if (audio.paused){ audio.play(); setPlayIcon(true); player.classList.add("playing"); }
  else { audio.pause(); setPlayIcon(false); player.classList.remove("playing"); }
}
function next(){ if (queue.length) play(qIndex + 1); }
function prev(){ if (queue.length) play(qIndex - 1); }

document.getElementById("p-play").onclick = togglePlay;
document.getElementById("p-next").onclick = next;
document.getElementById("p-prev").onclick = prev;
document.getElementById("p-fav").onclick = () => {
  if (qIndex < 0 || !queue[qIndex]) return;
  toggleFav(queue[qIndex], queue[qIndex]._cc || activeCode); refreshFavHearts();
};
document.getElementById("faves-btn").onclick = openFavorites;
updateFavCount();
importFavsFromHash();   // if opened via a "sync devices" link, merge those favorites in

/* ---------- YouTube full-song playback (per-track ytId; Cuba pilot) ---------- */
// A hidden audio-only IFrame player. Tracks with a ytId play here full-length, no login, for everyone.
// The IFrame API calls onYouTubeIframeAPIReady once loaded (script tag is after app.js in index.html).
let yt = null, ytReady = false, ytPoll = null, ytExpected = null;
const ytFailed = new Set();                              // ytIds that errored (embed disabled/removed) → don't retry
window.onYouTubeIframeAPIReady = function(){
  yt = new YT.Player("yt-player", {
    host: "https://www.youtube.com",
    playerVars: { playsinline: 1, rel: 0, controls: 0, modestbranding: 1 },
    events: {
      onReady:       () => { ytReady = true; },
      onStateChange: onYtState,
      onError:       onYtError
    }
  });
};
function stopYtPoll(){ if (ytPoll){ clearInterval(ytPoll); ytPoll = null; } }
function startYtPoll(){                                    // drive the progress bar off the YT playhead
  stopYtPoll();
  ytPoll = setInterval(() => {
    if (playSource !== "youtube" || !yt || scrubbing) return;
    const d = yt.getDuration ? yt.getDuration() : 0;
    const p = yt.getCurrentTime ? yt.getCurrentTime() : 0;
    if (d){ curDuration = d; setProg((p / d * 100) + "%"); }
  }, 250);
}
function stopYt(){ if (yt){ try { yt.pauseVideo(); } catch(_){} } stopYtPoll(); }
function onYtState(e){
  if (playSource !== "youtube") return;
  if (e.data === YT.PlayerState.PLAYING){ setPlayIcon(true);  player.classList.add("playing"); }
  if (e.data === YT.PlayerState.PAUSED){  setPlayIcon(false); player.classList.remove("playing"); }
  if (e.data === YT.PlayerState.ENDED){   next(); }                 // auto-advance like preview/Spotify
}
function onYtError(){                                                // embed disabled / removed / restricted
  if (playSource !== "youtube") return;
  const t = queue[qIndex];
  if (t && t.ytId) ytFailed.add(t.ytId);                            // stop retrying this one
  flashPlayerNote("full song unavailable — playing preview", 3000);
  playSource = "preview";
  play(qIndex);                                                     // re-run; ytFailed now skips the YT branch
}

/* ---------- playback source + player notes ---------- */
let playSource = "preview";

let currentNote = null;
function flashPlayerNote(msg, ms){
  const el = document.getElementById("p-artist"); if (!el) return;
  const prevHTML = el.innerHTML, prevCls = el.className;
  currentNote = msg;
  setMeta(el, esc(msg));                              // marquees the line when it overflows → long notes scroll on mobile
  let dur = ms || 2400;
  if (el.classList.contains("mq")){                  // it's scrolling → keep it up long enough to read a full loop
    const mq = parseFloat(el.style.getPropertyValue("--mq-dur")) || 0;
    if (mq) dur = Math.max(dur, mq * 1000 + 1500);
  }
  setTimeout(() => {
    if (currentNote !== msg) return;                 // a newer note or a track change replaced it → leave it
    currentNote = null; el.className = prevCls; el.innerHTML = prevHTML;
  }, dur);
}
audio.addEventListener("timeupdate", () => {
  if (!scrubbing && audio.duration) setProg((audio.currentTime/audio.duration*100) + "%");
});
audio.addEventListener("ended", next);
audio.addEventListener("pause", () => { setPlayIcon(false); player.classList.remove("playing"); });
audio.addEventListener("play",  () => { setPlayIcon(true);  player.classList.add("playing"); });

/* ---------- seek: click or drag the progress bar (works for preview + Spotify) ---------- */
let curDuration = 0, scrubbing = false;
// drive BOTH the play-bar and the expanded-card progress fills from one call
function setProg(w){
  const a = document.getElementById("p-progress"); if (a) a.style.width = w;
  const b = document.getElementById("art-progress"); if (b) b.style.width = w;
}
function barFrac(e, bar){
  const r = bar.getBoundingClientRect();
  const x = (e.clientX != null ? e.clientX : 0) - r.left;
  return Math.max(0, Math.min(1, r.width ? x / r.width : 0));
}
const setFill = f => setProg((f * 100) + "%");
function seekTo(f){
  if (playSource === "youtube"){ if (curDuration && yt && yt.seekTo) yt.seekTo(f * curDuration, true); }
  else if (audio.duration){ audio.currentTime = f * audio.duration; }
  setFill(f);
}
// same click/drag-to-seek behaviour on the play bar and the card's bar
function bindSeek(bar){
  if (!bar) return;
  bar.addEventListener("pointerdown", e => {
    if (qIndex < 0) return;
    scrubbing = true; bar.classList.add("scrub");
    try { bar.setPointerCapture(e.pointerId); } catch {}
    setFill(barFrac(e, bar)); e.preventDefault();
  });
  bar.addEventListener("pointermove", e => { if (scrubbing) setFill(barFrac(e, bar)); });
  bar.addEventListener("pointerup", e => { if (!scrubbing) return; scrubbing = false; bar.classList.remove("scrub"); seekTo(barFrac(e, bar)); });
  bar.addEventListener("pointercancel", () => { scrubbing = false; bar.classList.remove("scrub"); });
}
bindSeek(document.querySelector(".player__bar"));
bindSeek(document.querySelector(".art-modal__bar"));

function highlightRow(){
  const live = renderedList === queue;   // only highlight when the visible list is what's playing
  document.querySelectorAll(".track").forEach(el => el.classList.toggle("playing", live && +el.dataset.i === qIndex));
}

document.addEventListener("keydown", e => {
  if (e.code === "Space"){ e.preventDefault(); togglePlay(); }
  if (e.code === "ArrowRight") next();
  if (e.code === "ArrowLeft") prev();
  if (e.code === "Escape"){ const am = document.getElementById("art-modal"); if (am && !am.hidden) closeArt(); else backToMap(); }
});


/* ---------- list view (alternate to the map) ---------- */
let listBuilt = false;
function buildCountryList(){
  const clist = document.getElementById("clist"); if (!clist) return;
  const have = Object.entries(COUNTRIES).map(([code, c]) => ({ code, name: c.name, color: c.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const builtNames = new Set(Object.values(COUNTRIES).map(c => c.name));   // built countries with a null TopoJSON id (Kosovo, Somaliland) drop off "coming soon" by name
  // hide territories with no distinct streaming catalog (uninhabited / already covered elsewhere) — don't list as "coming soon"
  const SOON_HIDE = new Set(["Falkland Is.", "Fr. S. Antarctic Lands", "N. Cyprus"]);
  const soon = [...new Set(features
    .filter(f => +f.id !== 10 && !isoToCode[+f.id] && f.properties && f.properties.name && !builtNames.has(f.properties.name) && !SOON_HIDE.has(f.properties.name))
    .map(f => f.properties.name))].sort((a, b) => a.localeCompare(b));
  clist.innerHTML =
    '<div class="clist__sec">' +
    have.map(c => '<button class="clist__item" data-code="' + c.code + '" style="--accent:' + c.color + '">'
      + flagImg(c.code) + '<span class="clist__name">' + esc(c.name) + (WC2026.has(c.code) ? '<span class="wc-ball wc-ball--list" aria-hidden="true">⚽</span>' : '') + '</span></button>').join("") +
    '</div>' +
    (soon.length ? '<div class="clist__soonhdr">more countries — coming soon</div><div class="clist__soon">'
      + soon.map(n => '<span class="clist__soon-item">' + esc(n) + '</span>').join("") + '</div>' : "");
  clist.querySelectorAll(".clist__item").forEach(el => el.onclick = () => { openCountry(el.dataset.code); openPanel(); });
}
function setView(list){
  document.body.classList.toggle("list-view", list);
  document.getElementById("view-toggle").innerHTML = list
    ? '<svg class="vt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.3"/><line x1="2.7" y1="12" x2="21.3" y2="12"/><line x1="12" y1="2.7" x2="12" y2="21.3"/><path d="M12 2.7c2.7 2.6 4.2 5.9 4.2 9.3S14.7 18.7 12 21.3C9.3 18.7 7.8 15.4 7.8 12S9.3 5.3 12 2.7z"/></svg>map view'
    : "☰ all countries";
  if (list && (!listBuilt || !document.querySelector(".clist__item"))){ buildCountryList(); listBuilt = features.length > 0; }
}
document.getElementById("view-toggle").onclick = () => setView(!document.body.classList.contains("list-view"));
if (window.matchMedia && window.matchMedia("(max-width:680px)").matches) setView(true);  // mobile = list only


/* ---------- album art lightbox / expanded now-playing card ---------- */
const artModal = document.getElementById("art-modal");
function renderArtModal(){
  const t = queue[qIndex]; if (!t) return;
  const cc = t._cc || activeCode;
  if (t.cover) document.getElementById("art-modal-img").src = t.cover;
  document.getElementById("art-title").innerHTML = esc(t.title);
  // art card: artist on line 1, then flag · country · year · genre on line 2
  const capG = g => g ? g.replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : "";
  const sub = [];
  if (cc) sub.push(flagImg(cc) + " " + esc(COUNTRIES[cc].name));
  if (t.year) sub.push(String(t.year));
  if (t.genre) sub.push(esc(capG(t.genre)));
  document.getElementById("art-meta").innerHTML =
    `<div class="art-meta__artist">${esc(t.artist)}${t.diaspora ? '<span class="art-meta__dia">diáspora</span>' : ''}</div>` +
    (sub.length ? `<div class="art-meta__sub">${sub.join(" · ")}</div>` : "");
  document.getElementById("art-play").textContent = player.classList.contains("playing") ? "❚❚" : "▶";
  document.getElementById("art-fav").classList.toggle("on", isFav(t.trackId));
  const pp = document.getElementById("p-progress"), ap = document.getElementById("art-progress");
  if (pp && ap) ap.style.width = pp.style.width;   // sync fill on open (poll loop keeps it live after)
}
function openArt(){
  const t = queue[qIndex]; if (!t || !t.cover) return;
  renderArtModal();
  artModal.hidden = false;
}
function closeArt(){ artModal.hidden = true; }
document.getElementById("p-art").addEventListener("click", openArt);
document.getElementById("art-x").addEventListener("click", closeArt);
artModal.addEventListener("click", e => { if (e.target === artModal) closeArt(); });
// big transport controls inside the expanded card drive the same queue as the play bar
document.getElementById("art-prev").addEventListener("click", prev);
document.getElementById("art-play").addEventListener("click", togglePlay);
document.getElementById("art-next").addEventListener("click", next);
// mobile: drag the album art — horizontal = prev/next (carousel slide), swipe DOWN = close
(function(){
  const img = document.getElementById("art-modal-img");
  if (!img) return;
  img.style.touchAction = "none";
  let x0 = 0, y0 = 0, dx = 0, dy = 0, dragging = false, axis = null;
  const HT = 50, VT = 90;   // horizontal next/prev threshold, vertical close threshold
  img.addEventListener("pointerdown", e => {
    dragging = true; x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0; axis = null;
    img.style.transition = "none";
    try { img.setPointerCapture(e.pointerId); } catch(_){}
  });
  img.addEventListener("pointermove", e => {
    if (!dragging) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    if (axis === "x"){
      img.style.transform = `translateX(${dx}px) rotate(${dx*0.02}deg)`;
      img.style.opacity = String(1 - Math.min(Math.abs(dx)/500, 0.35));
    } else if (axis === "y"){
      const d = Math.max(dy, 0);   // downward only
      img.style.transform = `translateY(${d}px) scale(${1 - Math.min(d/1600, 0.12)})`;
      img.style.opacity = String(1 - Math.min(d/500, 0.5));
    }
  });
  const finish = () => {
    if (!dragging) return; dragging = false;
    if (axis === "x" && queue.length > 1 && Math.abs(dx) > HT){
      const goNext = dx < 0, W = img.offsetWidth || 260;
      img.style.transition = "transform .14s ease, opacity .14s ease";
      img.style.transform = `translateX(${goNext ? -W*1.3 : W*1.3}px) rotate(${goNext ? -8 : 8}deg)`;
      img.style.opacity = "0";
      setTimeout(() => {
        (goNext ? next : prev)();                                  // renderArtModal swaps in the new cover/title/meta
        img.style.transition = "none";
        img.style.transform = `translateX(${goNext ? W*0.9 : -W*0.9}px)`;   // new art enters from the opposite edge
        img.style.opacity = "0";
        requestAnimationFrame(() => {
          img.style.transition = "transform .2s ease, opacity .2s ease";
          img.style.transform = ""; img.style.opacity = "";
        });
      }, 130);
    } else if (axis === "y" && dy > VT){
      const H = img.offsetHeight || 260;                            // swipe down → dismiss
      img.style.transition = "transform .18s ease, opacity .18s ease";
      img.style.transform = `translateY(${H*1.4}px) scale(.8)`; img.style.opacity = "0";
      setTimeout(() => { closeArt(); img.style.transition = "none"; img.style.transform = ""; img.style.opacity = ""; }, 150);
    } else {
      img.style.transition = "transform .16s ease, opacity .16s ease";
      img.style.transform = ""; img.style.opacity = "";
    }
    dx = 0; dy = 0; axis = null;
  };
  img.addEventListener("pointerup", finish);
  img.addEventListener("pointercancel", finish);
})();
document.getElementById("art-fav").addEventListener("click", () => {
  const t = queue[qIndex]; if (!t) return;
  toggleFav(t, t._cc || activeCode);
  refreshFavHearts();
});


/* ===================== COUNTRY INFO / "DOSSIER" OVERLAY ===================== */
/* Opened by tapping the flag or name inside an open country panel. Prototype: Cuba (CU). */
const wmFile = f => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=1200`;
const wmFace = f => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=320`;   // small headshots

const COUNTRY_INFO = {
  CU: {
    tagline: "Isla Grande · the Caribbean's beating heart",
    // verified free photos (Wikimedia Commons) — major cities, landmarks, landscapes
    photos: [
      { f: "DJI_0197_crp_wiki.jpg",                       cap: "Havana skyline from the sea" },
      { f: "El_Capitolio_Havana_Cuba.jpg",                cap: "El Capitolio · Havana" },
      { f: "Havana_malecon_(cropped).jpg",                cap: "The Malecón · Havana" },
      { f: "Trinidad_in_Kuba.jpg",                        cap: "Colonial streets of Trinidad" },
      { f: "Viñales_Valley.jpg",                          cap: "Viñales tobacco valley" },
      { f: "Santiago_de_cuba_al_atardecer.jpg",           cap: "Santiago de Cuba at dusk" },
      { f: "Cuba_20160320_4849_Cienfuegos_sRGB.jpg",      cap: "Cienfuegos · 'Pearl of the South'" },
      { f: "Aerial_photo_of_Varadero_16.JPG",             cap: "Varadero beach" },
      { f: "Che_Guevara_-_Grab_in_Santa_Clara,_Kuba.jpg", cap: "Che Guevara Mausoleum · Santa Clara" },
      { f: "Ponte_de_Bacunayagua.JPG",                    cap: "Bacunayagua Bridge · Matanzas" },
    ],
    // recent independent, travel-focused overview video (verified embeddable)
    video: { id: "TX-dYjafzX8", title: "The Best of Cuba in 10 days", by: "Journeys with LeJune" },
    // cities plotted on the outline map ([lng, lat])
    cities: [
      { name: "Havana",          lng: -82.38, lat: 23.13, capital: true },
      { name: "Santa Clara",     lng: -79.97, lat: 22.41 },
      { name: "Cienfuegos",      lng: -80.44, lat: 22.15 },
      { name: "Trinidad",        lng: -79.98, lat: 21.80 },
      { name: "Camagüey",        lng: -77.92, lat: 21.38 },
      { name: "Holguín",         lng: -76.26, lat: 20.89 },
      { name: "Santiago de Cuba",lng: -75.82, lat: 20.02 },
    ],
    maps: "https://www.google.com/maps/place/Cuba/@21.6,-79.5,6z",
    facts: {
      capital:    "Havana (La Habana)",
      population: "≈ 11.0 million (2024)",
      languages:  "Spanish (official) · Haitian Creole & Lucumí also spoken",
      langCount:  "≈ 7 languages spoken in total",
      independence:"May 20, 1902 — republic founded (from Spain, Dec 10, 1898)",
      government: "Unitary Marxist–Leninist one-party socialist republic",
      etymology:  "From the Taíno — likely <em>cubao</em> (“where fertile land is abundant”) or <em>coabana</em> (“great place”). Columbus first named it <em>Juana</em>.",
    },
    people: [
      { n: "José Martí",        r: "national hero — poet & apostle of independence", img: "José_Martí_retrato_más_conocido_Jamaica_1892.jpg" },
      { n: "Carlos M. de Céspedes", r: "“Father of the Homeland” — freed his slaves, sparked 1868 war", img: "Carlos_Manuel_de_Cespedes_y_del_Castillo.jpg" },
      { n: "Antonio Maceo",     r: "the “Bronze Titan” — independence general", img: "Antonio_Maceo.jpg" },
      { n: "Fidel Castro",      r: "led the 1959 Revolution; ruled for ~49 years", img: "Fidel_Castro_1950s.jpg" },
      { n: "Che Guevara",       r: "Argentine-born revolutionary icon of the Cuban cause", img: "Che_Guevara_-_Guerrillero_Heroico_by_Alberto_Korda.jpg" },
    ],
    art:{n:"Wifredo Lam",r:"Afro-Cuban surrealist painter",img:"Wilfredo_Lam.jpg"},
      writer:{n:"José Martí",r:"Poet and independence hero",img:"José_Martí_retrato_más_conocido_Jamaica_1892.jpg"},
      stage:{n:"Andy García",r:"Oscar-nominated Cuban-American actor",img:"Andy_Garcia_at_the_2026_Cannes_Film_Festival_03.jpg"},
      music:  { n: "Celia Cruz",       r: "the “Queen of Salsa” — ¡Azúcar!", img: "Celia_Cruz_1957_color.jpg" },
    sports: { n: "Teófilo Stevenson", r: "3× Olympic heavyweight boxing champion (1972·76·80)", img: "Bundesarchiv_Bild_183-1985-1004-023,_Teofilo_Stevenson_cropped.jpg" },
    // A short, honest history — good and bad — written to be understood by a 12-year-old.
    timeline: [
      { y: "1492",        t: "Columbus arrives",       d: "Christopher Columbus lands in Cuba and claims the island for Spain — even though the native Taíno people have already lived here for centuries." },
      { y: "1510s",       t: "Spain takes over",        d: "Spanish soldiers conquer Cuba. Within a few decades, war, forced labor, and European diseases wipe out almost all of the Taíno." },
      { y: "1500s–1800s", t: "The slave trade",         d: "Spain ships hundreds of thousands of enslaved Africans to Cuba to work and die on its sugar and tobacco plantations. Slavery becomes the engine of the economy." },
      { y: "1868",        t: "First war for freedom",   d: "Plantation owner Carlos Manuel de Céspedes frees his own slaves and declares war on Spain, launching Cuba's long fight for independence." },
      { y: "1886",        t: "Slavery abolished",       d: "After nearly 400 years, Cuba finally ends slavery — one of the very last countries in the Americas to do so." },
      { y: "1895",        t: "Martí's independence war", d: "Poet José Martí and generals like Antonio Maceo lead a new revolt. Martí is killed in his first battle and becomes Cuba's greatest national hero." },
      { y: "1898",        t: "The U.S. steps in",        d: "After the American warship USS Maine blows up in Havana's harbor, the U.S. joins the war and defeats Spain — then takes control of Cuba itself." },
      { y: "1902",        t: "Republic of Cuba",         d: "Cuba becomes its own country, but the U.S. keeps the right to interfere in its affairs and holds onto the Guantánamo Bay naval base." },
      { y: "1952",        t: "Batista's dictatorship",   d: "Fulgencio Batista seizes power in a coup and rules as a corrupt dictator while most Cubans stay poor." },
      { y: "1959",        t: "Castro's Revolution",      d: "Fidel Castro overthrows Batista and turns Cuba into a communist state allied with the Soviet Union. He rules for nearly 50 years, and hundreds of thousands of Cubans flee the island." },
      { y: "1962",        t: "The Missile Crisis",       d: "The Soviet Union secretly places nuclear missiles in Cuba. For 13 tense days the world stands on the edge of nuclear war, until the missiles are removed." },
      { y: "1991",        t: "The “Special Period”", d: "When the Soviet Union collapses, Cuba loses its biggest ally. Food, fuel, and electricity run desperately short, and the hard years drag on through the 1990s." },
      { y: "2016",        t: "Fidel Castro dies",        d: "The revolution's leader dies at 90. His brother Raúl had already begun small openings, and for a brief moment Cuba and the U.S. reopened relations." },
      { y: "2021–today",  t: "Protests & exodus",        d: "Cubans hold the largest protests in generations, demanding freedom and food. The economy crumbles, the power grid fails in nationwide blackouts, and record numbers of people flee the island — the biggest exodus in Cuban history." },
    ],
    sources: [
      { label: "Photos",            detail: "Wikimedia Commons — CC-licensed, individual contributors", url: "https://commons.wikimedia.org/wiki/Category:Cuba" },
      { label: "Facts & figures",   detail: "Wikipedia — “Cuba” & related articles",                    url: "https://en.wikipedia.org/wiki/Cuba" },
      { label: "History timeline",  detail: "Wikipedia — “History of Cuba”",                            url: "https://en.wikipedia.org/wiki/History_of_Cuba" },
      { label: "Travel film",       detail: "YouTube — “The Best of Cuba in 10 days” · Journeys with LeJune", url: "https://www.youtube.com/watch?v=TX-dYjafzX8" },
      { label: "Map outline",       detail: "Natural Earth via world-atlas — public domain",             url: "https://www.naturalearthdata.com/" },
      { label: "Location",          detail: "Google Maps",                                               url: "https://www.google.com/maps/place/Cuba/@21.6,-79.5,6z" },
    ],
  },
  BR: {
    tagline: "Terra do pau-brasil · samba, sun & the Amazon's green heart",
    photos: [ { f: "Cidade_Maravilhosa.jpg", cap: "Rio de Janeiro · Cidade Maravilhosa" }, { f: "Pão_de_Açucar_-_Sugarloaf_Mountain_-_Zuckerhut_-_2022.jpg", cap: "Sugarloaf Mountain · Rio" }, { f: "Praia_de_Copacabana_-_Rio_de_Janeiro,_Brasil.jpg", cap: "Copacabana beach · Rio" }, { f: "Iguazu_Cataratas2.jpg", cap: "Iguaçu Falls · on the Argentine border" }, { f: "Marginal_Pinheiros_e_Jockey_Club.jpg", cap: "São Paulo · the concrete giant" }, { f: "Planalto_Central_(cropped).jpg", cap: "Brasília · the modernist capital" }, { f: "Salvador_BA_(cropped)_2.jpg", cap: "Salvador · Afro-Brazilian soul of Bahia" }, { f: "Conjunto_arquitetônico_e_urbanístico_de_Ouro_Preto.JPG", cap: "Ouro Preto · baroque gold town" }, { f: "Amazon17_(5641020319).jpg", cap: "The Amazon · Earth's greatest rainforest" }, { f: "Lençóis_Maranhenses_2018.jpg", cap: "Lençóis Maranhenses · dunes & lagoons" } ],
    video: { id: "QaZjbKbBdIo", title: "15 BEST Things to do in Rio de Janeiro", by: "Go Places with Tati & Brennan" },
    cities: [ { name: "Brasília", lng: -47.93, lat: -15.78, capital: true }, { name: "São Paulo", lng: -46.63, lat: -23.55 }, { name: "Rio de Janeiro", lng: -43.20, lat: -22.91 }, { name: "Salvador", lng: -38.51, lat: -12.97 }, { name: "Belo Horizonte", lng: -43.94, lat: -19.92 }, { name: "Fortaleza", lng: -38.54, lat: -3.73 }, { name: "Manaus", lng: -60.03, lat: -3.12 }, { name: "Recife", lng: -34.88, lat: -8.05 } ],
    maps: "https://www.google.com/maps/place/Brazil/@-13.5,-52.0,4z",
    facts: { capital: "Brasília", population: "≈ 212 million (2024)", languages: "Portuguese (official) · plus German, Italian, Japanese & 150+ Indigenous tongues", langCount: "≈ 217 languages spoken in total", independence: "September 7, 1822 — from Portugal (Grito do Ipiranga)", government: "Federal presidential constitutional republic", etymology: "Named for <em>pau-brasil</em> (brazilwood), the red dyewood traders shipped to Europe — <em>brasa</em> meaning \"ember\" for its glowing hue." },
    people: [ { n: "Pedro I", r: "declared independence — Brazil's first emperor", img: "DpedroI-brasil-full_(cropped).jpg" }, { n: "Tiradentes", r: "martyr of the Inconfidência independence revolt", img: "José_da_Silva_Xavier,_o_Tiradentes.jpg" }, { n: "Princess Isabel", r: "signed the Lei Áurea abolishing slavery, 1888", img: "Isabel,_Princesa_do_Brasil,_1846-1921_(cropped).jpg" }, { n: "Zumbi dos Palmares", r: "leader of Palmares — icon of Black resistance", img: "Antônio_Parreiras_-_Zumbi_2.jpg" }, { n: "Santos Dumont", r: "aviation pioneer — flew the 14-bis, 1906", img: "Alberto_Santos-Dumont_by_Zaida_Ben-Yusuf.jpg" } ],
    art:{n:"Tarsila do Amaral",r:"Modernist painter of Brazil",img:"Tarsila_do_Amaral,_ca._1925.jpg"},
      writer:{n:"Machado de Assis",r:"Master realist novelist",img:"Machado_de_Assis_by_Marc_Ferrez.jpg"},
      stage:{n:"Fernanda Montenegro",r:"Oscar-nominated grande dame actress",img:"Fernanda_Montenegro2019.jpg"},
      music: { n: "Tom Jobim", r: "father of bossa nova — \"The Girl from Ipanema\"", img: "Antônio_Carlos_Jobim_(cropped).jpg" },
    sports: { n: "Pelé", r: "3× World Cup winner — football's king", img: "Pele_con_brasil_(cropped).jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Brazil"}, {label:"Facts & figures",detail:"Wikipedia — \"Brazil\" & related articles",url:"https://en.wikipedia.org/wiki/Brazil"}, {label:"Travel film",detail:"YouTube — \"15 BEST Things to do in Rio de Janeiro\" · Go Places with Tati & Brennan",url:"https://www.youtube.com/watch?v=QaZjbKbBdIo"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Brazil/@-13.5,-52.0,4z"} ],
  },
  JP: {
    tagline: "Nihon · Land of the Rising Sun",
    photos: [ { f: "Skyscrapers_of_Shinjuku_2009_January.jpg", cap: "Tokyo skyline over Shinjuku" }, { f: "View_of_Mount_Fuji_from_Ōwakudani_20211202.jpg", cap: "Mount Fuji from Ōwakudani" }, { f: "Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine,_Kyoto,_Japan.jpg", cap: "Vermilion torii tunnels at Fushimi Inari, Kyoto" }, { f: "Osaka_Castle_02bs3200.jpg", cap: "Osaka Castle above the moat" }, { f: "Sakura_and_Moss_Pink_-_桜(さくら)と芝桜(しばざくら).jpg", cap: "Cherry blossoms in full bloom" }, { f: "Tōdai-ji_Kon-dō.jpg", cap: "Tōdai-ji's Great Buddha Hall, Nara" }, { f: "Genbaku_Dome04-r.JPG", cap: "Hiroshima Peace Memorial — the Genbaku Dome" }, { f: "Shibuya_Crossing,_Aerial.jpg", cap: "Shibuya Crossing from above" }, { f: "Itsukushima_Shrine_Torii_Gate_(13890465459).jpg", cap: "The floating torii of Itsukushima" }, { f: "Golden_Pavilion_Kinkaku-ji_water_mirror_2024.jpg", cap: "Kinkaku-ji, the Golden Pavilion" } ],
    video: { id: "SM4edIt2Sw0", title: "10 Days in Japan — Tokyo, Kyoto, Mount Fuji & Beyond", by: "Taylor Morello" },
    cities: [ { name: "Tokyo", lng: 139.69, lat: 35.69, capital: true }, { name: "Yokohama", lng: 139.64, lat: 35.44 }, { name: "Osaka", lng: 135.50, lat: 34.69 }, { name: "Nagoya", lng: 136.91, lat: 35.18 }, { name: "Sapporo", lng: 141.35, lat: 43.06 }, { name: "Fukuoka", lng: 130.40, lat: 33.59 }, { name: "Kyoto", lng: 135.77, lat: 35.01 }, { name: "Hiroshima", lng: 132.46, lat: 34.39 } ],
    maps: "https://www.google.com/maps/place/Japan/@36.2,138.3,5z",
    facts: { capital: "Tokyo (東京)", population: "≈ 123.8 million (2024)", languages: "Japanese (de facto official) · Ryukyuan languages & Ainu also spoken", langCount: "≈ 15 languages spoken in total", independence: "Feb 11, 660 BC — traditional founding (Kigen-setsu) · postwar Constitution effective May 3, 1947", government: "Unitary parliamentary constitutional monarchy", etymology: "From <em>Nihon</em>/<em>Nippon</em> (日本) — \"origin of the sun,\" hence the \"Land of the Rising Sun.\"" },
    people: [ { n: "Emperor Meiji", r: "reign launched Japan's modern transformation", img: "Meiji_Emperor_(cropped)(b).jpg" }, { n: "Tokugawa Ieyasu", r: "first Tokugawa shōgun — unified Japan", img: "Tokugawa_Ieyasu2.JPG" }, { n: "Oda Nobunaga", r: "warlord who began Japan's reunification", img: "Odanobunaga.jpg" }, { n: "Prince Shōtoku", r: "ancient regent who spread Buddhism & law", img: "Shōtoku_Taishi_Shōmankyō_Kōsan.jpg" }, { n: "Murasaki Shikibu", r: "author of The Tale of Genji", img: "Murasaki-Shikibu-composing-Genji-Monogatari.png" } ],
    art:{n:"Katsushika Hokusai",r:"Great Wave woodblock printmaker",img:"Hokusai_as_an_old_man.jpg"},
      writer:{n:"Haruki Murakami",r:"Surreal bestselling novelist",img:"Conversatorio_Haruki_Murakami_(12_de_12)_(45747009452)_(cropped).jpg"},
      stage:{n:"Toshiro Mifune",r:"Iconic Kurosawa samurai actor",img:"Toshiro_Mifune_1954_Scan10003_160913.jpg"},
      music: { n: "Ryuichi Sakamoto", r: "Oscar-winning composer & YMO pioneer", img: "Ryuichi_Sakamoto_side.jpg" },
    sports: { n: "Shohei Ohtani", r: "two-way baseball phenom — global superstar", img: "Dodgers_at_Nationals_(53677192000)_(cropped).jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Japan"}, {label:"Facts & figures",detail:"Wikipedia — \"Japan\" & related articles",url:"https://en.wikipedia.org/wiki/Japan"}, {label:"Travel film",detail:"YouTube — \"10 Days in Japan\" · Taylor Morello",url:"https://www.youtube.com/watch?v=SM4edIt2Sw0"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Japan/@36.2,138.3,5z"} ],
  },
  NG: {
    tagline: "Naijá · giant of Africa, home of Afrobeats",
    photos: [ { f: "Tafa_Balewa_Square_(Onikan)_in_Lagos._Nigeria.jpg", cap: "Tafawa Balewa Square, Lagos Island" }, { f: "Abuja_heritages_30.jpg", cap: "Abuja — the purpose-built capital" }, { f: "Aso_Rock_as_seen_from_the_IBB_golf_course_in_Abuja,_Nigeria.jpg", cap: "Aso Rock rising above Abuja" }, { f: "Zuma_Rock.jpg", cap: "Zuma Rock — the gateway to Abuja" }, { f: "Abuja_National_Mosque.jpg", cap: "The National Mosque, Abuja" }, { f: "Yankari_Entry_Gate.jpg", cap: "Yankari — Nigeria's premier game reserve" }, { f: "Osun_groove_Osogbo.jpg", cap: "Osun-Osogbo Sacred Grove — a UNESCO site" }, { f: "Durbar.jpg", cap: "The Durbar — a northern horse festival" }, { f: "Eyo_Olokun.jpg", cap: "The Eyo masquerade of Lagos" }, { f: "Tarkwa_bay_beach,_Lagos,_Nigeria.jpg", cap: "Tarkwa Bay beach, Lagos" } ],
    video: { id: "ZYbnHc7GbGU", title: "Nigeria, Lagos Travel Vlog", by: "Tobias Becs" },
    cities: [ { name: "Abuja", lng: 7.49, lat: 9.06, capital: true }, { name: "Lagos", lng: 3.38, lat: 6.52 }, { name: "Kano", lng: 8.52, lat: 12.00 }, { name: "Ibadan", lng: 3.90, lat: 7.38 }, { name: "Port Harcourt", lng: 7.01, lat: 4.82 }, { name: "Benin City", lng: 5.62, lat: 6.34 }, { name: "Kaduna", lng: 7.44, lat: 10.52 }, { name: "Enugu", lng: 7.51, lat: 6.44 } ],
    maps: "https://www.google.com/maps/place/Nigeria/@9.08,8.68,6z",
    facts: { capital: "Abuja", population: "≈ 223 million (2024)", languages: "English (official) · Hausa, Yoruba & Igbo are the major languages", langCount: "≈ 500+ languages spoken in total", independence: "October 1, 1960 — from the United Kingdom", government: "Federal presidential republic", etymology: "Coined from the <em>Niger</em> River — the \"Niger area.\"" },
    people: [ { n: "Nnamdi Azikiwe", r: "\"Zik\" — first President, father of the nation", img: "Nnamdi_Azikiwe_PC_(cropped).jpg" }, { n: "Obafemi Awolowo", r: "premier statesman & federalist of the west", img: "Obafemi_Awolowo.jpg" }, { n: "Ahmadu Bello", r: "Sardauna of Sokoto — leader of the north", img: "Sir_Ahmadu_Bello_(1959).jpg" }, { n: "Herbert Macaulay", r: "father of Nigerian nationalism", img: "Herbert_Macaulay_portrait.jpg" }, { n: "Wole Soyinka", r: "playwright — Africa's first Nobel laureate in Literature", img: "Wole_Soyinka_in_2018_(3x4_cropped).jpg" } ],
    art:{n:"Ben Enwonwu",r:"Pioneering modernist painter-sculptor",img:"Ben_Enonwu_working_on_a_sculpture_of_Ann_Gerrard_(1957)_(cropped).jpg"},
      writer:{n:"Chinua Achebe",r:"Things Fall Apart novelist",img:"Chinua_Achebe,_1966.jpg"},
      stage:{n:"John Boyega",r:"Star Wars leading actor",img:"John_Boyega_(54716098702).jpg"},
      music: { n: "Fela Kuti", r: "the pioneer of Afrobeat — music as protest", img: "Fela_Kuti_circa_1986.jpg" },
    sports: { n: "Jay-Jay Okocha", r: "mercurial midfield magician of the Super Eagles", img: "Match_legends_2017_CC_(5).jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Nigeria"}, {label:"Facts & figures",detail:"Wikipedia — \"Nigeria\" & related articles",url:"https://en.wikipedia.org/wiki/Nigeria"}, {label:"Travel film",detail:"YouTube — \"Nigeria, Lagos Travel Vlog\" · Tobias Becs",url:"https://www.youtube.com/watch?v=ZYbnHc7GbGU"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Nigeria/@9.08,8.68,6z"} ],
  },
  FR: {
    tagline: "L'Hexagone · art, alps & Mediterranean light",
    photos: [ { f: "Tour_Eiffel_Wikimedia_Commons_(cropped).jpg", cap: "The Eiffel Tower over Paris" }, { f: "Louvre_Museum_Wikimedia_Commons.jpg", cap: "The Louvre's glass pyramid" }, { f: "Mont-Saint-Michel_vu_du_ciel.jpg", cap: "Mont-Saint-Michel rising from the bay" }, { f: "Promenade_des_Anglais_Nice_IMG_1255.jpg", cap: "Nice & the Côte d'Azur" }, { f: "Vue_aérienne_du_domaine_de_Versailles_par_ToucanWings_-_Creative_Commons_By_Sa_3.0_-_081_(cropped).jpg", cap: "The Palace of Versailles from above" }, { f: "Lavender_field_and_Mont_Ventoux.jpg", cap: "Provence lavender under Mont Ventoux" }, { f: "Mont_Blanc_Aiguille.jpg", cap: "Mont Blanc in the French Alps" }, { f: "Aerial_image_of_Château_de_Chambord_(view_from_the_southeast).jpg", cap: "Château de Chambord, Loire Valley" }, { f: "Bordeaux_Place_de_la_Bourse_de_nuit.jpg", cap: "Bordeaux's Place de la Bourse at night" }, { f: "Vue_d'Étretat.jpg", cap: "The chalk cliffs of Étretat" } ],
    video: { id: "U8vk9p7ZZKQ", title: "10 Day South of France Itinerary", by: "Min and John" },
    cities: [ { name: "Paris", lng: 2.35, lat: 48.86, capital: true }, { name: "Marseille", lng: 5.37, lat: 43.30 }, { name: "Lyon", lng: 4.83, lat: 45.76 }, { name: "Toulouse", lng: 1.44, lat: 43.60 }, { name: "Nice", lng: 7.27, lat: 43.70 }, { name: "Bordeaux", lng: -0.58, lat: 44.84 }, { name: "Strasbourg", lng: 7.75, lat: 48.57 }, { name: "Lille", lng: 3.06, lat: 50.63 } ],
    maps: "https://www.google.com/maps/place/France/@46.6,2.4,6z",
    facts: { capital: "Paris", population: "≈ 68.5 million (2024)", languages: "French (official) · regional: Occitan, Breton, Alsatian, Corsican, Basque", langCount: "≈ 25 languages spoken in total", independence: "Aug 843 — Treaty of Verdun carves out West Francia; unified kingdom 987 (Hugh Capet); Fifth Republic since 1958", government: "Unitary semi-presidential republic", etymology: "From the <em>Franks</em> — Latin <em>Francia</em>, \"land of the Franks,\" likely from a Germanic word meaning <em>free</em>." },
    people: [ { n: "Napoleon Bonaparte", r: "emperor who reshaped Europe & French law", img: "Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg" }, { n: "Louis XIV", r: "the \"Sun King\" — 72-year reign, built Versailles", img: "Louis_XIV_of_France.jpg" }, { n: "Joan of Arc", r: "peasant saint & heroine of the Hundred Years' War", img: "Joan_of_Arc_miniature_graded.jpg" }, { n: "Charles de Gaulle", r: "wartime leader & founder of the Fifth Republic", img: "De_Gaulle-OWI_(cropped)_(c)(2).jpg" }, { n: "Marie Curie", r: "two-time Nobel laureate — pioneer of radioactivity", img: "Marie_Curie_c._1920s.jpg" } ],
    art:{n:"Claude Monet",r:"Founding Impressionist landscape painter",img:"Claude_Monet_1899_Nadar_crop.jpg"},
      writer:{n:"Victor Hugo",r:"Les Misérables Romantic novelist",img:"Victor_Hugo_by_Étienne_Carjat_1876_-_full.jpg"},
      stage:{n:"Marion Cotillard",r:"Oscar-winning film actress",img:"Marion_Cotillard_at_2019_Cannes.jpg"},
      music: { n: "Édith Piaf", r: "the voice of France — \"La Vie en rose\"", img: "Piaf_Harcourt_1946_2.jpg" },
    sports: { n: "Zinedine Zidane", r: "1998 World Cup hero — one of football's greats", img: "Zinedine_Zidane_by_Tasnim_03.jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:France"}, {label:"Facts & figures",detail:"Wikipedia — \"France\" & related articles",url:"https://en.wikipedia.org/wiki/France"}, {label:"Travel film",detail:"YouTube — \"10 Day South of France Itinerary\" · Min and John",url:"https://www.youtube.com/watch?v=U8vk9p7ZZKQ"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/France/@46.6,2.4,6z"} ],
  },
  IN: {
    tagline: "Bharat · a subcontinent of a thousand worlds",
    photos: [ { f: "Taj_Mahal_(Edited).jpeg", cap: "The Taj Mahal at Agra" }, { f: "20191219_Fort_Amber,_Amer,_Jaipur_0955_9481.jpg", cap: "Amber Fort above Jaipur" }, { f: "East_facade_Hawa_Mahal_Jaipur_from_ground_level_(July_2022)_-_img_01.jpg", cap: "Hawa Mahal — Jaipur's Palace of Winds" }, { f: "Dasaswamedh_ghat-varanasi_india-andres_larin.jpg", cap: "Varanasi's ghats on the Ganges" }, { f: "Mumbai_03-2016_30_Gateway_of_India.jpg", cap: "Gateway of India, Mumbai" }, { f: "House_Boat_DSW.jpg", cap: "Houseboat on the Kerala backwaters" }, { f: "The_Golden_Temple_of_Amrithsar_7.jpg", cap: "The Golden Temple, Amritsar" }, { f: "Road_Padum_Zanskar_Range_Jun24_A7CR_00818.jpg", cap: "A mountain road through Ladakh" }, { f: "India_Gate_(All_India_War_Memorial).jpg", cap: "India Gate, New Delhi" }, { f: "Palolem_Beach,_South_Goa.jpg", cap: "Palolem Beach, South Goa" } ],
    video: { id: "HWGzQlrJOqM", title: "Top 10 Places to Visit in India", by: "Stef Hoffer" },
    cities: [ { name: "New Delhi", lng: 77.21, lat: 28.61, capital: true }, { name: "Mumbai", lng: 72.88, lat: 19.08 }, { name: "Bengaluru", lng: 77.59, lat: 12.97 }, { name: "Kolkata", lng: 88.36, lat: 22.57 }, { name: "Chennai", lng: 80.27, lat: 13.08 }, { name: "Hyderabad", lng: 78.47, lat: 17.39 }, { name: "Jaipur", lng: 75.79, lat: 26.91 }, { name: "Varanasi", lng: 82.97, lat: 25.32 } ],
    maps: "https://www.google.com/maps/place/India/@22.35,78.9,5z",
    facts: { capital: "New Delhi", population: "≈ 1.43 billion (2024) — the world's most populous", languages: "Hindi & English (official at union level) · 22 scheduled languages", langCount: "≈ 450+ languages spoken in total", independence: "August 15, 1947 — from the United Kingdom", government: "Federal parliamentary constitutional republic", etymology: "\"India\" from the <em>Indus</em> River (Sanskrit <em>Sindhu</em>); \"Bharat\" from Emperor <em>Bharata</em>." },
    people: [ { n: "Mahatma Gandhi", r: "father of the nation — led nonviolent independence", img: "Mahatma-Gandhi,_studio,_1931.jpg" }, { n: "Jawaharlal Nehru", r: "India's first prime minister", img: "Nehru_in_the_Netherlands,_1957.jpg" }, { n: "B. R. Ambedkar", r: "chief architect of the Constitution", img: "Dr._Bhimrao_Ambedkar.jpg" }, { n: "Rabindranath Tagore", r: "poet — first non-European Nobel laureate", img: "1926_Rabindrath_Tagore.jpg" }, { n: "Subhas Chandra Bose", r: "\"Netaji\" — radical independence leader", img: "Subhas_Chandra_Bose_NRB.jpg" } ],
    art:{n:"Raja Ravi Varma",r:"Iconic mythological academic painter",img:"Ravivarma1b.jpg"},
      writer:{n:"Rabindranath Tagore",r:"Nobel-winning poet-polymath",img:"1926_Rabindrath_Tagore.jpg"},
      stage:{n:"Amitabh Bachchan",r:"Bollywood's legendary leading man",img:"Indian_actor_Amitabh_Bachchan.jpg"},
      music: { n: "Ravi Shankar", r: "sitar maestro who brought Indian music to the world", img: "Ravi_Shankar.jpg" },
    sports: { n: "Sachin Tendulkar", r: "the \"Little Master\" — cricket's greatest run-scorer", img: "The_cricket_legend_Sachin_Tendulkar_at_the_Oval_Maidan_in_Mumbai_During_the_Duke_and_Duchess_of_Cambridge_Visit(26271019082).jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:India"}, {label:"Facts & figures",detail:"Wikipedia — \"India\" & related articles",url:"https://en.wikipedia.org/wiki/India"}, {label:"Travel film",detail:"YouTube — \"Top 10 Places to Visit in India\" · Stef Hoffer",url:"https://www.youtube.com/watch?v=HWGzQlrJOqM"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/India/@22.35,78.9,5z"} ],
  },
  MX: { tagline:"Corazón de las Américas · where ancient empires meet endless coastlines",
   photos:[{f:"Zócalo,_Ciudad_de_México_(32846556446)_(cropped).jpg",cap:"The Zócalo · Mexico City"},{f:"Angel_de_la_independencia170409.jpg",cap:"Ángel de la Independencia · Mexico City"},{f:"Teotihuacán-5973.JPG",cap:"Pyramids of Teotihuacán"},{f:"Chichen_Itza_3.jpg",cap:"El Castillo · Chichén Itzá"},{f:"Panorámica_Guadalajara_desde_edificio_Bansi_hacia_norte_(cropped).jpg",cap:"Guadalajara skyline · Jalisco"},{f:"MonteAlbanWest.jpg",cap:"Monte Albán above Oaxaca"},{f:"San_Miguel_de_Allende_Collage.jpg",cap:"San Miguel de Allende · Guanajuato"},{f:"Tulum_2.jpg",cap:"Maya ruins over the sea · Tulum"},{f:"Collage_Cabo_San_Lucas.jpg",cap:"El Arco · Cabo San Lucas"},{f:"Barranca_del_cobre_2.jpg",cap:"Copper Canyon · Chihuahua"}],
   video:{id:"nq5JangW7hE",title:"Top 10 Best Places to Visit in Mexico - Travel Video 2025",by:"Travel Insights"},
   cities:[{name:"Mexico City",lng:-99.13,lat:19.43,capital:true},{name:"Guadalajara",lng:-103.35,lat:20.67},{name:"Monterrey",lng:-100.32,lat:25.69},{name:"Puebla",lng:-98.21,lat:19.04},{name:"Tijuana",lng:-117.04,lat:32.51},{name:"Cancún",lng:-86.85,lat:21.16},{name:"Mérida",lng:-89.62,lat:20.97},{name:"Oaxaca",lng:-96.72,lat:17.06}],
   maps:"https://www.google.com/maps/place/Mexico/@23.6,-102.5,5z",
   facts:{capital:"Mexico City (Ciudad de México)",population:"≈ 129 million (2024)",languages:"Spanish (de facto official) · 68 Indigenous language groups recognized",langCount:"≈ 290+ languages spoken in total",independence:"Sept 16, 1810 declared — Sept 27, 1821 from Spain",government:"Federal presidential constitutional republic",etymology:"From <em>Mēxihco</em> — the Aztec (<em>Mexica</em>) heartland in the Nahuatl language."},
   people:[{n:"Benito Juárez",r:"reforming president — \"respect for others' rights is peace\"",img:"Photograph_of_Benito_Juarez.jpg"},{n:"Miguel Hidalgo",r:"priest who launched the War of Independence",img:"Generalísimo_Miguel_Hidalgo_y_Costilla.png"},{n:"Emiliano Zapata",r:"revolutionary hero — \"land and liberty\"",img:"Emiliano_Zapata4.jpg"},{n:"Frida Kahlo",r:"painter — icon of art, pain & identity",img:"Frida_Kahlo,_by_Guillermo_Kahlo.jpg"},{n:"Sor Juana Inés de la Cruz",r:"colonial poet & pioneer of women's thought",img:"Sor_Juana_by_Miguel_Cabrera.png"}],
   art:{n:"Frida Kahlo",r:"Surrealist self-portrait painter",img:"Frida_Kahlo,_by_Guillermo_Kahlo.jpg"},
      writer:{n:"Octavio Paz",r:"Nobel-winning poet-essayist",img:"Octavio_Paz_-_1988_Malmö.jpg"},
      stage:{n:"Salma Hayek",r:"Oscar-nominated film actress",img:"MKr383631_Salma_Hayek_(Women_In_Motion,_Cannes_2025)_crop.jpg"},
      music:{n:"Vicente Fernández",r:"\"El Rey\" of ranchera — the voice of Mexico",img:"Vicente_Fernández_-_Pepsi_Center_-_06.11.11.jpg"},
   sports:{n:"Canelo Álvarez",r:"undisputed boxing world champion",img:"Saúl_Álvarez.png"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Mexico"},{label:"Facts & figures",detail:"Wikipedia — \"Mexico\" & related articles",url:"https://en.wikipedia.org/wiki/Mexico"},{label:"Travel film",detail:"YouTube — \"Top 10 Best Places to Visit in Mexico\" · Travel Insights",url:"https://www.youtube.com/watch?v=nq5JangW7hE"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Mexico/@23.6,-102.5,5z"}] },
  AR: { tagline:"Tierra del Plata · silver land at the end of the world",
   photos:[{f:"Avenida_9_de_Julio,_Buenos_Aires_(40089810910).jpg",cap:"Avenida 9 de Julio & the Obelisco · Buenos Aires"},{f:"Casa_Rosada_exterior_from_Plaza_de_Mayo.JPG",cap:"Casa Rosada · Plaza de Mayo, Buenos Aires"},{f:"Caminito_-_Entrada.jpg",cap:"Caminito · the painted alley of La Boca"},{f:"Iguazu_Cataratas2.jpg",cap:"Iguazú Falls · the roaring jungle border"},{f:"Perito_Moreno_Glacier_2023.jpg",cap:"Perito Moreno Glacier · Patagonian ice"},{f:"El_Chaltén.jpg",cap:"El Chaltén & Mount Fitz Roy · Patagonia"},{f:"Catedral_desde_el_Lago_Nahuel_Huapi_-_panoramio.jpg",cap:"Bariloche · lakes of Nahuel Huapi"},{f:"Ushuaia_aerial_panorama.jpg",cap:"Ushuaia · the end of the world"},{f:"Downtown_Mendoza.jpg",cap:"Mendoza · Malbec wine country"},{f:"Panorámica_Ciudad_de_Salta.jpg",cap:"Salta · the colonial northwest"}],
   video:{id:"OnrJkX4LDBs",title:"Top 10 Places To Visit in Argentina - Travel Guide",by:"Ryan Shirley"},
   cities:[{name:"Buenos Aires",lng:-58.38,lat:-34.60,capital:true},{name:"Córdoba",lng:-64.19,lat:-31.42},{name:"Rosario",lng:-60.64,lat:-32.95},{name:"Mendoza",lng:-68.84,lat:-32.89},{name:"La Plata",lng:-57.95,lat:-34.92},{name:"San Miguel de Tucumán",lng:-65.22,lat:-26.82},{name:"Mar del Plata",lng:-57.55,lat:-38.00},{name:"Salta",lng:-65.41,lat:-24.79}],
   maps:"https://www.google.com/maps/place/Argentina/@-38,-63,4z",
   facts:{capital:"Buenos Aires",population:"≈ 46.0 million (2024)",languages:"Spanish (official) · Guaraní, Quechua & Mapudungun among regional tongues",langCount:"≈ 40 languages spoken in total",independence:"July 9, 1816 — from Spain",government:"Federal presidential constitutional republic",etymology:"From the Latin <em>argentum</em> — \"silver\" — for the fabled riches of the Río de la Plata."},
   people:[{n:"José de San Martín",r:"El Libertador — liberator of Argentina, Chile & Peru",img:"José_de_San_Martín_(retrato,_c.1828).jpg"},{n:"Manuel Belgrano",r:"revolutionary who created the national flag",img:"Manuel_belgrano_by_carbonier_retouched.jpg"},{n:"Domingo F. Sarmiento",r:"president & father of public education",img:"Sarmiento.jpg"},{n:"Eva Perón",r:"\"Evita\" — beloved first lady & champion of workers",img:"Evita_color.jpg"},{n:"Jorge Luis Borges",r:"giant of world literature",img:"Jorge_Luis_Borges_1951,_by_Grete_Stern_(full).jpg"}],
   art:{n:"Antonio Berni",r:"Socially engaged figurative painter",img:"Antonio_Berni_by_Anatole_Saderman,_1971.jpg"}, writer:{n:"Jorge Luis Borges",r:"Labyrinthine short-story master",img:"Jorge_Luis_Borges_1951,_by_Grete_Stern_(full).jpg"}, stage:{n:"Ricardo Darín",r:"Acclaimed leading film actor",img:"Alejandra_Darín_y_Ricardo_Darín_(cropped).jpg"}, music:{n:"Carlos Gardel",r:"the immortal voice of tango",img:"Carlos_gardel_en_su_casa_1933.jpg"},
   sports:{n:"Diego Maradona",r:"football legend — 1986 World Cup champion",img:"Argentina_celebrando_copa_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Argentina"},{label:"Facts & figures",detail:"Wikipedia — \"Argentina\" & related articles",url:"https://en.wikipedia.org/wiki/Argentina"},{label:"Travel film",detail:"YouTube — \"Top 10 Places To Visit in Argentina - Travel Guide\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=OnrJkX4LDBs"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Argentina/@-38,-63,4z"}] },
  ES: { tagline:"España · flamenco fire, Moorish stone & Mediterranean sun",
   photos:[{f:"SF_maig_2_cropped.jpg",cap:"Sagrada Família · Barcelona"},{f:"Dawn_Charles_V_Palace_Alhambra_Granada_Andalusia_Spain.jpg",cap:"The Alhambra · Granada"},{f:"Madrid_Plaza_Mayor_(48733706273).jpg",cap:"Plaza Mayor · Madrid"},{f:"Plaza_de_España_(Sevilla)_-_01.jpg",cap:"Plaza de España · Seville"},{f:"Parc_guell_-_panoramio.jpg",cap:"Park Güell · Barcelona"},{f:"Toledo_(37737041515).jpg",cap:"Toledo · the city of three cultures"},{f:"San_Sebastián_-_Ayuntamiento_10.jpg",cap:"San Sebastián · the Basque coast"},{f:"2002_wurde_das_Ozeaneum_in_Valencia_eröffnet._14.jpg",cap:"City of Arts & Sciences · Valencia"},{f:"Ronda_aerial.jpg",cap:"Ronda · the cliff-top town"},{f:"Picu_Urriellu.jpg",cap:"Picos de Europa · the northern peaks"}],
   video:{id:"IaaFExw8Zt4",title:"SPAIN - Timeless Charms｜Cinematic Travel Video",by:"Marko Gruntar"},
   cities:[{name:"Madrid",lng:-3.70,lat:40.42,capital:true},{name:"Barcelona",lng:2.17,lat:41.39},{name:"Valencia",lng:-0.38,lat:39.47},{name:"Seville",lng:-5.98,lat:37.39},{name:"Zaragoza",lng:-0.89,lat:41.65},{name:"Málaga",lng:-4.42,lat:36.72},{name:"Bilbao",lng:-2.93,lat:43.26},{name:"Granada",lng:-3.60,lat:37.18}],
   maps:"https://www.google.com/maps/place/Spain/@40.0,-3.7,5z",
   facts:{capital:"Madrid",population:"≈ 48.9 million (2024)",languages:"Spanish/Castilian (official); co-official Catalan, Galician, Basque & Valencian",langCount:"≈ 15 languages spoken in total",independence:"Unified 1479 under the Catholic Monarchs — modern democracy since the 1978 Constitution",government:"Unitary parliamentary constitutional monarchy",etymology:"From <em>Hispania</em>, the Roman name for the peninsula — perhaps from Punic <em>ʾî-šapan</em>."},
   people:[{n:"Isabella I of Castile",r:"queen who unified Spain & funded 1492",img:"IsabellaofCastile03.jpg"},{n:"Miguel de Cervantes",r:"author of Don Quixote — father of the modern novel",img:"Cervantes_Jáuregui.jpg"},{n:"Francisco Goya",r:"revolutionary painter of court & war",img:"Vicente_López_Portaña_-_el_pintor_Francisco_de_Goya.jpg"},{n:"Pablo Picasso",r:"co-founder of Cubism — 20th-century titan",img:"Pablo_picasso_1.jpg"},{n:"Salvador Dalí",r:"surrealism's melting-clock showman",img:"Salvador_Dalí_1939.jpg"}],
   art:{n:"Pablo Picasso",r:"Cubist painter, modern-art titan",img:"Pablo_picasso_1.jpg"}, writer:{n:"Miguel de Cervantes",r:"Wrote Don Quixote",img:"Cervantes_Jáuregui.jpg"}, stage:{n:"Antonio Banderas",r:"International film and stage star",img:"Goyas_2025_-_Antonio_Banderas_(cropped).jpg"}, music:{n:"Paco de Lucía",r:"the flamenco guitarist who took it worldwide",img:"Paco_de_Lucía_4.jpg"},
   sports:{n:"Rafael Nadal",r:"22× Grand Slam champion — the \"King of Clay\"",img:"Rafael_Nadal_en_2024_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Spain"},{label:"Facts & figures",detail:"Wikipedia — \"Spain\" & related articles",url:"https://en.wikipedia.org/wiki/Spain"},{label:"Travel film",detail:"YouTube — \"SPAIN - Timeless Charms｜Cinematic Travel Video\" · Marko Gruntar",url:"https://www.youtube.com/watch?v=IaaFExw8Zt4"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Spain/@40.0,-3.7,5z"}] },
  IT: { tagline:"Il Bel Paese · where every road leads to beauty",
   photos:[{f:"Colosseo_2020.jpg",cap:"The Colosseum · Rome"},{f:"Venezia_aerial_view.jpg",cap:"The canals of Venice from above"},{f:"Cattedrale_di_Santa_Maria_del_Fiore_–_Il_Duomo_di_Firenze.jpg",cap:"Brunelleschi's Duomo · Florence"},{f:"Amalfi_Coast_(Italy,_October_2020)_-_75_(50558355441).jpg",cap:"The Amalfi Coast"},{f:"Portofino,_Italy_2025.jpg",cap:"Portofino harbor · Liguria"},{f:"Milan_Cathedral_from_Piazza_del_Duomo.jpg",cap:"The Duomo · Milan"},{f:"Cinque_Terre_(Italy,_October_2020)_-_24_(50543603956).jpg",cap:"Cinque Terre · the five lands"},{f:"Aerial_image_of_Pompeii_and_Mount_Vesuvius_(view_from_the_southeast).jpg",cap:"Pompeii beneath Vesuvius"},{f:"Sentiero_del_Viandante_DSC_6340_(14020554463).jpg",cap:"Lake Como"},{f:"Faloria_Cortina_d'Ampezzo_10.jpg",cap:"The Dolomites · Cortina d'Ampezzo"}],
   video:{id:"olf-OvqzGd0",title:"Italy by Train | 10 Days Itinerary to Rome, Florence & Venice",by:"MultiCityTrips"},
   cities:[{name:"Rome",lng:12.50,lat:41.90,capital:true},{name:"Milan",lng:9.19,lat:45.46},{name:"Naples",lng:14.27,lat:40.85},{name:"Turin",lng:7.69,lat:45.07},{name:"Florence",lng:11.26,lat:43.77},{name:"Venice",lng:12.34,lat:45.44},{name:"Bologna",lng:11.34,lat:44.49},{name:"Palermo",lng:13.36,lat:38.12}],
   maps:"https://www.google.com/maps/place/Italy/@42,12,5z",
   facts:{capital:"Rome (Roma)",population:"≈ 59 million (2024)",languages:"Italian (official)",langCount:"≈ 34 languages spoken in total",independence:"March 17, 1861 — Kingdom of Italy proclaimed; Republic since 1946",government:"Unitary parliamentary republic",etymology:"From <em>Italia</em> — an ancient name possibly meaning <em>land of calves</em> (cattle)."},
   people:[{n:"Julius Caesar",r:"general & statesman who reshaped Rome",img:"Retrato_de_Julio_César_(26724093101)_(cropped).jpg"},{n:"Leonardo da Vinci",r:"Renaissance polymath — artist & inventor",img:"Francesco_Melzi_-_Portrait_of_Leonardo.png"},{n:"Michelangelo",r:"sculptor & painter of the Sistine Chapel",img:"Michelangelo_Daniele_da_Volterra_(dettaglio).jpg"},{n:"Dante Alighieri",r:"poet — father of the Italian language",img:"Bargello_-_Kapelle_Fresko_2a.jpg"},{n:"Giuseppe Garibaldi",r:"hero of Italian unification",img:"Garibaldi_(1866).jpg"}],
   art:{n:"Leonardo da Vinci",r:"Renaissance painter of Mona Lisa",img:"Francesco_Melzi_-_Portrait_of_Leonardo.png"}, writer:{n:"Dante Alighieri",r:"Poet of the Divine Comedy",img:"Bargello_-_Kapelle_Fresko_2a.jpg"}, stage:{n:"Sophia Loren",r:"Oscar-winning screen icon",img:"Gala_de_Închidere_TIFF_2016_(27490660976)_(cropped).jpg"}, music:{n:"Luciano Pavarotti",r:"the greatest operatic tenor of his age",img:"Luciano_Pavarotti_2004.jpg"},
   sports:{n:"Valentino Rossi",r:"9× MotoGP world champion — \"The Doctor\"",img:"Valentino_Rossi_2024_WEC_Fuji_6.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Italy"},{label:"Facts & figures",detail:"Wikipedia — \"Italy\" & related articles",url:"https://en.wikipedia.org/wiki/Italy"},{label:"Travel film",detail:"YouTube — \"Italy by Train | 10 Days Itinerary to Rome, Florence & Venice\" · MultiCityTrips",url:"https://www.youtube.com/watch?v=olf-OvqzGd0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Italy/@42,12,5z"}] },
  GB: { tagline:"These islands — where the world learned to make noise",
   photos:[{f:"Elizabeth_Tower,_June_2022.jpg",cap:"Big Ben & Westminster · London"},{f:"Tower_Bridge_at_Dawn.jpg",cap:"Tower Bridge at dawn · London"},{f:"Stonehenge2007_07_30.jpg",cap:"Stonehenge · Wiltshire"},{f:"City_of_Edinburgh_-_Edinburgh_Castle_-_20140421004403.jpg",cap:"Edinburgh Castle · Scotland"},{f:"GlencoeVillage.jpg",cap:"Glen Coe · Scottish Highlands"},{f:"Derwent_Water,_Lake_District,_Cumbria_-_June_2009.jpg",cap:"Derwent Water · Lake District"},{f:"Roman_Baths_in_Bath_Spa,_England_-_July_2006.jpg",cap:"The Roman Baths · Bath"},{f:"Causeway-code_poet-4.jpg",cap:"Giant's Causeway · Northern Ireland"},{f:"Snowdon_Ranger_path_on_a_cold_February_day._(16431627106).jpg",cap:"Snowdonia (Eryri) · Wales"},{f:"Castle_combe_cotswolds.jpg",cap:"Castle Combe · the Cotswolds"}],
   video:{id:"rd1K1sBf1Ug",title:"THINGS TO KNOW BEFORE YOU GO TO THE UK",by:"Creative Travel Guide"},
   cities:[{name:"London",lng:-0.13,lat:51.51,capital:true},{name:"Birmingham",lng:-1.90,lat:52.48},{name:"Manchester",lng:-2.24,lat:53.48},{name:"Glasgow",lng:-4.25,lat:55.86},{name:"Edinburgh",lng:-3.19,lat:55.95},{name:"Liverpool",lng:-2.99,lat:53.41},{name:"Cardiff",lng:-3.18,lat:51.48},{name:"Belfast",lng:-5.93,lat:54.60}],
   maps:"https://www.google.com/maps/place/United+Kingdom/@54,-2,5z",
   facts:{capital:"London",population:"≈ 68.3 million (2024)",languages:"English (de facto); Welsh, Scottish Gaelic, Irish, Cornish, Scots",langCount:"≈ 15 languages spoken in total",independence:"Formed by union — Acts of Union 1707 (Great Britain) & 1801 (United Kingdom)",government:"Unitary parliamentary constitutional monarchy",etymology:"\"Britain\" from the <em>Pretani/Britanni</em> — the island's Celtic peoples — via Latin <em>Britannia</em>."},
   people:[{n:"Winston Churchill",r:"wartime PM — rallied Britain through WWII",img:"Sir_Winston_Churchill_-_19086236948_(restored).jpg"},{n:"William Shakespeare",r:"the Bard — greatest writer in English",img:"William_Shakespeare_by_John_Taylor,_edited.jpg"},{n:"Isaac Newton",r:"gravity, motion & calculus — modern physics",img:"Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"},{n:"Charles Darwin",r:"naturalist — theory of evolution",img:"Charles_Darwin_seated_crop.jpg"},{n:"Elizabeth I",r:"Gloriana — queen of England's golden age",img:"Darnley_stage_3.jpg"}],
   art:{n:"J. M. W. Turner",r:"Master of luminous landscapes",img:"Joseph_Mallord_William_Turner_auto-retrato.jpg"}, writer:{n:"William Shakespeare",r:"The Bard, playwright and poet",img:"William_Shakespeare_by_John_Taylor,_edited.jpg"}, stage:{n:"Charlie Chaplin",r:"Silent-film comic legend",img:"Charlie_Chaplin_portrait_Getty_1739411952.jpg"}, music:{n:"The Beatles",r:"the best-selling band in history — from Liverpool",img:"The_Beatles_1963_Dezo_Hoffman_Capitol_Records_press_photo_2.jpg"},
   sports:{n:"David Beckham",r:"football icon — free-kick maestro turned global star",img:"David_Beckham_UNICEF_(cropped2).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:United_Kingdom"},{label:"Facts & figures",detail:"Wikipedia — \"United Kingdom\" & related articles",url:"https://en.wikipedia.org/wiki/United_Kingdom"},{label:"Travel film",detail:"YouTube — \"THINGS TO KNOW BEFORE YOU GO TO THE UK\" · Creative Travel Guide",url:"https://www.youtube.com/watch?v=rd1K1sBf1Ug"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/United+Kingdom/@54,-2,5z"}] },
  US: { tagline:"Sea to shining sea · fifty states, one restless dream",
   photos:[{f:"View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_(cropped).jpg",cap:"Manhattan skyline · New York City"},{f:"Canyon_River_Tree_(165872763).jpeg",cap:"The Grand Canyon · Arizona"},{f:"Golden_Gate_Bridge_as_seen_from_Battery_East.jpg",cap:"Golden Gate Bridge · San Francisco"},{f:"Statue_of_liberty_and_nyc_skyline.jpg",cap:"Statue of Liberty · New York Harbor"},{f:"Grand_Canyon_of_yellowstone.jpg",cap:"Grand Canyon of the Yellowstone · Wyoming"},{f:"Las_Vegas_Strip_09_2017_4897.jpg",cap:"The Strip after dark · Las Vegas"},{f:"Capitol_Building_Full_View.jpg",cap:"The U.S. Capitol · Washington, D.C."},{f:"French_Quarter,_looking_north_with_Mississippi_River_to_the_right_2011.jpg",cap:"The French Quarter · New Orleans"},{f:"Monument_Valley,_Utah,_USA_(23611451292).jpg",cap:"Monument Valley · Utah–Arizona border"},{f:"Central_Californian_Coastline,_Big_Sur_-_May_2013.jpg",cap:"The Big Sur coast · California"}],
   video:{id:"Yaw22v_lG80",title:"10 DAY USA ROAD TRIP — Yosemite, Sequoia, Death Valley, Zion, Bryce, Vegas",by:"Karl Watson: Travel Documentaries"},
   cities:[{name:"Washington, D.C.",lng:-77.04,lat:38.91,capital:true},{name:"New York",lng:-74.01,lat:40.71},{name:"Los Angeles",lng:-118.24,lat:34.05},{name:"Chicago",lng:-87.63,lat:41.88},{name:"Houston",lng:-95.37,lat:29.76},{name:"San Francisco",lng:-122.42,lat:37.77},{name:"Honolulu",lng:-157.86,lat:21.31},{name:"Anchorage",lng:-149.90,lat:61.22}],
   maps:"https://www.google.com/maps/place/United+States/@39.8,-98.6,4z",
   facts:{capital:"Washington, D.C.",population:"≈ 335 million (2024)",languages:"English (de facto national); Spanish widely spoken — no official language federally",langCount:"≈ 350+ languages spoken in total",independence:"July 4, 1776 — from Great Britain",government:"Federal presidential constitutional republic",etymology:"Named for Italian explorer <em>Amerigo Vespucci</em> — Latinized as <em>America</em>."},
   people:[{n:"George Washington",r:"first president — commander of the Revolution",img:"Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg"},{n:"Abraham Lincoln",r:"16th president — preserved the Union, ended slavery",img:"Abraham_Lincoln_1863_Portrait_(3x4_cropped).jpg"},{n:"Thomas Jefferson",r:"author of the Declaration of Independence",img:"Official_Presidential_portrait_of_Thomas_Jefferson_(by_Rembrandt_Peale,_1800).jpg"},{n:"Martin Luther King Jr.",r:"civil rights leader — \"I Have a Dream\"",img:"Martin_Luther_King,_Jr..jpg"},{n:"Benjamin Franklin",r:"founding father, inventor & diplomat",img:"Joseph_Siffrein_Duplessis_-_Benjamin_Franklin_-_Google_Art_Project.jpg"}],
   art:{n:"Andy Warhol",r:"Pop-art pioneer",img:"Andy_Warhol_at_the_Jewish_Museum_(by_Bernard_Gotfryd)_–_LOC.jpg"}, writer:{n:"Mark Twain",r:"Novelist, \"father of American literature\"",img:"Mark_Twain_by_AF_Bradley_(cropped_2).jpg"}, stage:{n:"Marilyn Monroe",r:"Film actress & cultural icon",img:"Monroecirca1953.jpg"}, music:{n:"Michael Jackson",r:"the \"King of Pop\" — best-selling artist of all time",img:"Michael_Jackson_1983_(3x4_cropped)_(contrast).jpg"},
   sports:{n:"Muhammad Ali",r:"3× heavyweight boxing champion — \"The Greatest\"",img:"Muhammad_Ali_NYWTS.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:United_States"},{label:"Facts & figures",detail:"Wikipedia — \"United States\" & related articles",url:"https://en.wikipedia.org/wiki/United_States"},{label:"Travel film",detail:"YouTube — \"10 DAY USA ROAD TRIP\" · Karl Watson: Travel Documentaries",url:"https://www.youtube.com/watch?v=Yaw22v_lG80"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/United+States/@39.8,-98.6,4z"}] },
  EG: { tagline:"Umm al-Dunya · the Mother of the World, cradle of the Nile",
   photos:[{f:"Pyramids_of_the_Giza_Necropolis.jpg",cap:"Pyramids of Giza · Giza Plateau"},{f:"Sphinx_with_the_third_pyramid.jpg",cap:"The Great Sphinx · Giza"},{f:"Temple_de_Louxor_68.jpg",cap:"Karnak Temple · Luxor"},{f:"Luxor,_Tal_der_Könige_(1995,_860x605).jpg",cap:"Valley of the Kings · Luxor"},{f:"Ramsis,_Aswan_Governorate,_Egypt_-_panoramio.jpg",cap:"Abu Simbel · Aswan Governorate"},{f:"Cairo_Opera_House,_Al_Hurriyah_Park_and_the_Nile_river_(14797782354).jpg",cap:"Cairo & the Nile · from Zamalek"},{f:"Nile_3rd_Cataract_Left.jpg",cap:"The Nile · lifeblood of Egypt"},{f:"QaitbeyCitadel.jpg",cap:"Citadel of Qaitbay · Alexandria"},{f:"Panoramic_view_of_Aswan,_Egypt.jpg",cap:"Aswan · on the Upper Nile"},{f:"Al_Farafrah,_New_Valley_Governorate,_Egypt_-_panoramio_(21).jpg",cap:"White Desert · near Farafra"}],
   video:{id:"qMSLLNZkEb0",title:"Ultimate 12 Day Egypt Itinerary | Cairo, Luxor, Aswan, Abu Simbel & Siwa",by:"Go Global with Sibu"},
   cities:[{name:"Cairo",lng:31.24,lat:30.06,capital:true},{name:"Alexandria",lng:29.92,lat:31.20},{name:"Giza",lng:31.21,lat:30.01},{name:"Luxor",lng:32.64,lat:25.69},{name:"Aswan",lng:32.90,lat:24.09},{name:"Port Said",lng:32.30,lat:31.26},{name:"Sharm El Sheikh",lng:34.33,lat:27.92},{name:"Hurghada",lng:33.83,lat:27.26}],
   maps:"https://www.google.com/maps/place/Egypt/@26.8,30,5z",
   facts:{capital:"Cairo (Al-Qāhira)",population:"≈ 112 million (2024)",languages:"Arabic (official); Egyptian Arabic vernacular; Coptic (liturgical), Nubian",langCount:"≈ 12 languages spoken in total",independence:"February 28, 1922 — from the United Kingdom",government:"Unitary semi-presidential republic",etymology:"From Greek <em>Aígyptos</em>; the Arabic name is <em>Miṣr</em>."},
   people:[{n:"Ramesses II",r:"the Great — mightiest pharaoh of the New Kingdom",img:"Ramses_II_British_Museum.jpg"},{n:"Cleopatra VII",r:"last pharaoh of Ptolemaic Egypt",img:"Kleopatra-VII.-Altes-Museum-Berlin1.jpg"},{n:"Tutankhamun",r:"boy-king whose golden tomb dazzled the world",img:"CairoEgMuseumTaaMaskMostlyPhotographed.jpg"},{n:"Gamal Abdel Nasser",r:"president who led Arab nationalism",img:"Stevan_Kragujevic,_Gamal_Abdel_Naser_u_Beogradu,_1962.jpg"},{n:"Anwar Sadat",r:"president & Nobel peace laureate",img:"Official_Portrait_-_Anwar_Sadat.jpg"}],
   art:{n:"Mahmoud Mokhtar",r:"Father of modern Egyptian sculpture",img:"Mahmoud_Mokhtar.jpg"}, writer:{n:"Naguib Mahfouz",r:"Nobel Prize-winning novelist",img:"Nagib_Mahfouz.jpg"}, stage:{n:"Omar Sharif",r:"Lawrence of Arabia film star",img:"Omar_Sharif_1963.JPG"}, music:{n:"Umm Kulthum",r:"the \"Star of the East\" — the Arab world's greatest voice",img:"Umm_Kulthum_as_Fatimah.jpg"},
   sports:{n:"Mohamed Salah",r:"football superstar — the \"Egyptian King\"",img:"Mohamed_Salah_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Egypt"},{label:"Facts & figures",detail:"Wikipedia — \"Egypt\" & related articles",url:"https://en.wikipedia.org/wiki/Egypt"},{label:"Travel film",detail:"YouTube — \"Ultimate 12 Day Egypt Itinerary\" · Go Global with Sibu",url:"https://www.youtube.com/watch?v=qMSLLNZkEb0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Egypt/@26.8,30,5z"}] },
  KR: { tagline:"Land of the Morning Calm · where hanok meets hypermodern",
   photos:[{f:"Bukchon_Hanok_Village_01.jpg",cap:"Bukchon Hanok Village · Seoul"},{f:"광화문_월대.jpg",cap:"Gyeongbokgung Palace · Seoul"},{f:"Cheonggyecheon_stream_at_sunrise_with_trees_in_Seoul.jpg",cap:"Cheonggyecheon stream · Seoul"},{f:"Namsan_and_Namsan_Tour_at_Dusk.jpg",cap:"Seoul skyline at dusk"},{f:"Gwangan_Bridge1.jpg",cap:"Gwangan Bridge · Busan"},{f:"Gamcheon_Houses,_2024.jpg",cap:"Gamcheon Culture Village · Busan"},{f:"Jeju_Island.jpg",cap:"Jeju Island coast"},{f:"Seongsan_Ilchulbong_from_the_air.jpg",cap:"Seongsan Ilchulbong · Jeju"},{f:"Lotus_Flower_Bridge_and_Seven_Treasure_Bridge_at_Bulguksa_in_Gyeongju,_Korea.jpg",cap:"Bulguksa Temple · Gyeongju"},{f:"Dinosaur_Ridge_of_Seoraksan.jpg",cap:"Seoraksan National Park"}],
   video:{id:"AA-sv3ilNBE",title:"South Korea 4K Drone Video | Seoul, Busan, Songdo Cinematic Aerials",by:"Explore The World 4K"},
   cities:[{name:"Seoul",lng:126.98,lat:37.57,capital:true},{name:"Busan",lng:129.08,lat:35.18},{name:"Incheon",lng:126.71,lat:37.46},{name:"Daegu",lng:128.60,lat:35.87},{name:"Daejeon",lng:127.38,lat:36.35},{name:"Gwangju",lng:126.85,lat:35.16},{name:"Ulsan",lng:129.31,lat:35.54},{name:"Jeonju",lng:127.15,lat:35.82}],
   maps:"https://www.google.com/maps/place/South+Korea/@36.5,127.8,7z",
   facts:{capital:"Seoul",population:"≈ 51.7 million (2024)",languages:"Korean (official); Korean Sign Language",langCount:"≈ 3 languages spoken in total",independence:"Aug 15, 1945 — liberation from Japan; ROK founded Aug 15, 1948",government:"Unitary presidential republic",etymology:"From the medieval <em>Goryeo</em> dynasty; the Korean name is <em>Hanguk</em>."},
   people:[{n:"King Sejong the Great",r:"created Hangul, Korea's alphabet",img:"King_sejong_the_great_gwanghwamun_square_police-859145.jpg"},{n:"Yi Sun-sin",r:"admiral who never lost a naval battle",img:"Bust_of_Yi_Sun-sin_01.jpg"},{n:"Ahn Jung-geun",r:"independence activist — assassinated Itō Hirobumi",img:"An_Jung-geun.JPG"},{n:"Kim Gu",r:"leader of the Korean independence movement",img:"Kim_Gu_in_1949.jpg"},{n:"Yu Gwan-sun",r:"teenage martyr of the March 1st Movement",img:"Ryu_Gwan-sun.jpg"}],
   art:{n:"Nam June Paik",r:"Pioneer of video art",img:"Paik Nam June (cropped).jpg"}, writer:{n:"Han Kang",r:"Nobel Prize-winning novelist",img:"Han_Kang,_2024_Nobel_Prize_Laureate_in_Literature_(cropped).jpg"}, stage:{n:"Lee Byung-hun",r:"Acclaimed film and TV actor",img:"Lee_Byung-hun_2025_Toronto_(cropped).jpg"}, music:{n:"BTS",r:"the K-pop juggernaut that conquered the world",img:"BTS_during_a_White_House_press_conference_May_31,_2022_(cropped).jpg"},
   sports:{n:"Son Heung-min",r:"Tottenham captain — Premier League goal machine",img:"BFA_2023_-2_Heung-Min_Son_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:South_Korea"},{label:"Facts & figures",detail:"Wikipedia — \"South Korea\" & related articles",url:"https://en.wikipedia.org/wiki/South_Korea"},{label:"Travel film",detail:"YouTube — \"South Korea 4K Drone Video\" · Explore The World 4K",url:"https://www.youtube.com/watch?v=AA-sv3ilNBE"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/South+Korea/@36.5,127.8,7z"}] },
  CO: { tagline:"Land of a thousand rhythms · where the Andes meet two oceans",
   photos:[{f:"Centro_historico_de_Cartagena.jpg",cap:"Walled old city · Cartagena"},{f:"BOGOTA_CITY_(cropped).jpg",cap:"Andean skyline · Bogotá"},{f:"2017_Bogotá_Basílica_del_Señor_Caído_de_Monserrate.jpg",cap:"Monserrate sanctuary · Bogotá"},{f:"El_Poblado_Medellín.jpg",cap:"El Poblado · Medellín"},{f:"Grafitti_-_Plaza_-_Comuna_13_-_Medellín_-_Colombia_2024.jpg",cap:"Street art of Comuna 13 · Medellín"},{f:"View_of_Salento,_Colombia_01.jpg",cap:"Coffee country · Salento"},{f:"Valle_del_cocora_-_general_view.jpg",cap:"Wax palms of Cocora Valley"},{f:"Caño_Cristales_01.jpg",cap:"The \"river of five colors\" · Caño Cristales"},{f:"Arrecifes.jpg",cap:"Caribbean coast · Tayrona"},{f:"El_Peñol_de_Guatapé_(The_Rock_of_Guatape)_2017-04-10.jpg",cap:"El Peñol rock · Guatapé"}],
   video:{id:"DWchxY3XhXQ",title:"Exploring Colombia - Full Travel Documentary",by:"BackPacker Steve"},
   cities:[{name:"Bogotá",lng:-74.07,lat:4.71,capital:true},{name:"Medellín",lng:-75.56,lat:6.24},{name:"Cali",lng:-76.53,lat:3.45},{name:"Barranquilla",lng:-74.80,lat:10.97},{name:"Cartagena",lng:-75.51,lat:10.42},{name:"Bucaramanga",lng:-73.12,lat:7.12},{name:"Santa Marta",lng:-74.20,lat:11.24}],
   maps:"https://www.google.com/maps/place/Colombia/@4.6,-74,5z",
   facts:{capital:"Bogotá",population:"≈ 52.3 million (2024)",languages:"Spanish (official)",langCount:"≈ 70+ languages spoken in total",independence:"July 20, 1810 declared · Aug 7, 1819 from Spain",government:"Unitary presidential republic",etymology:"Named after <em>Christopher Columbus</em> — <em>Cristóbal Colón</em> in Spanish."},
   people:[{n:"Simón Bolívar",r:"El Libertador — led independence across the Andes",img:"Simón_Bolívar._Toro_Moreno,_Luis._1922,_Legislative_Palace,_La_Paz.png"},{n:"Francisco de Paula Santander",r:"\"Man of Laws\" — founding statesman & president",img:"Santander_by_Acevedo_Bernal.jpg"},{n:"Gabriel García Márquez",r:"Nobel novelist — father of magical realism",img:"Gabriel_Garcia_Marquez.jpg"},{n:"Policarpa Salavarrieta",r:"\"La Pola\" — martyr heroine of independence",img:"Policarpa_Salabarrieta.jpg"},{n:"Antonio Nariño",r:"precursor of independence — translated the Rights of Man",img:"Nariño_by_Acevedo_Bernal.jpg"}],
   art:{n:"Fernando Botero",r:"Painter of voluptuous figures",img:"Fernando_Botero_(2018).jpg"}, writer:{n:"Gabriel García Márquez",r:"Nobel laureate, magical realism",img:"Gabriel_Garcia_Marquez.jpg"}, stage:{n:"Sofía Vergara",r:"Star of Modern Family",img:"Sofía_Vergara_2019_by_Glenn_Francis.jpg"}, music:{n:"Shakira",r:"the global pop superstar from Barranquilla",img:"2023-11-16_Gala_de_los_Latin_Grammy,_03_(cropped)02.jpg"},
   sports:{n:"James Rodríguez",r:"playmaker — 2014 World Cup Golden Boot winner",img:"James_Rodriguez_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Colombia"},{label:"Facts & figures",detail:"Wikipedia — \"Colombia\" & related articles",url:"https://en.wikipedia.org/wiki/Colombia"},{label:"Travel film",detail:"YouTube — \"Exploring Colombia - Full Travel Documentary\" · BackPacker Steve",url:"https://www.youtube.com/watch?v=DWchxY3XhXQ"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Colombia/@4.6,-74,5z"}] },
  JM: { tagline:"Xaymaca · land of wood and water",
   photos:[{f:"Dunns_River_Falls_climb.JPG",cap:"Dunn's River Falls · Ocho Rios"},{f:"Negril_Jamaica_2007-09.jpg",cap:"Seven Mile Beach · Negril"},{f:"JM_Blue_Mountain_Peak_1010_(78)_(17049629637).jpg",cap:"Blue Mountain Peak"},{f:"PortofKingston.jpg",cap:"Kingston Harbour · the capital"},{f:"Montego_Bay_Photo_Don_Ramey_Logan.jpg",cap:"Montego Bay"},{f:"JM-ocho_rios-hafen-01.jpg",cap:"Ocho Rios waterfront"},{f:"Port_antonio2.JPG",cap:"Port Antonio · the northeast coast"},{f:"Devonhouse.jpg",cap:"Devon House · Kingston"},{f:"St.-Jago-de-la-Vega.JPG",cap:"Spanish Town · the old capital"},{f:"Farming_on_the_slopes_of_the_John_Crow.jpg",cap:"John Crow Mountains · Rio Grande valley"}],
   video:{id:"Y9vAska3-as",title:"OCHO RIOS | 10 Amazing Things to do",by:"LIST - Life In Style Travel"},
   cities:[{name:"Kingston",lng:-76.79,lat:17.97,capital:true},{name:"Montego Bay",lng:-77.92,lat:18.47},{name:"Spanish Town",lng:-76.95,lat:17.99},{name:"Portmore",lng:-76.88,lat:17.95},{name:"Ocho Rios",lng:-77.10,lat:18.41},{name:"Negril",lng:-78.35,lat:18.27},{name:"Port Antonio",lng:-76.45,lat:18.18}],
   maps:"https://www.google.com/maps/place/Jamaica/@18.1,-77.3,8z",
   facts:{capital:"Kingston",population:"≈ 2.8 million (2024)",languages:"English (official); Jamaican Patois widely spoken",langCount:"≈ 3 languages spoken in total",independence:"August 6, 1962 — from the United Kingdom",government:"Unitary parliamentary constitutional monarchy",etymology:"From the Taíno <em>Xaymaca</em> — \"land of wood and water.\""},
   people:[{n:"Marcus Garvey",r:"national hero — Pan-Africanist leader & orator",img:"Marcus_Garvey,_\"Provisional_President_of_Africa\",_by_the_Keystone_View_Company.jpg"},{n:"Alexander Bustamante",r:"national hero — first Prime Minister",img:"Prime_Minister_of_Jamaica,_Sir_Alexander_Bustamante_(04)_(cropped).jpg"},{n:"Norman Manley",r:"national hero — independence-era statesman",img:"Norman_Manley,_The_Miami_Herald_1955_08_04_(cropped).jpg"},{n:"Paul Bogle",r:"national hero — led the Morant Bay rebellion",img:"PaulBogle-MorantBay.jpg"},{n:"Samuel Sharpe",r:"national hero — led the 1831 slave revolt",img:"Samsharpe.JPG"}],
   art:{n:"Edna Manley",r:"Mother of Jamaican sculpture",img:"Edna_Manley_1955_press_photo_(cropped).jpg"}, writer:{n:"Claude McKay",r:"Harlem Renaissance poet-novelist",img:"Claude_McKay_James_L._Allen_Portrait_Edit.jpg"}, stage:{n:"Madge Sinclair",r:"Emmy-winning film-TV actress",img:"Madge_Sinclair_in_Boesman_and_Lena.jpg"}, music:{n:"Bob Marley",r:"reggae legend — global voice of Jamaica",img:"Bob_Marley_1976_press_photo.jpg"},
   sports:{n:"Usain Bolt",r:"8× Olympic champion — fastest man ever",img:"Usain_Bolt_smiling_Berlin_2009.JPG"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Jamaica"},{label:"Facts & figures",detail:"Wikipedia — \"Jamaica\" & related articles",url:"https://en.wikipedia.org/wiki/Jamaica"},{label:"Travel film",detail:"YouTube — \"OCHO RIOS | 10 Amazing Things to do\" · LIST - Life In Style Travel",url:"https://www.youtube.com/watch?v=Y9vAska3-as"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Jamaica/@18.1,-77.3,8z"}] },
  CA: { tagline:"The True North · strong and free — from Rockies to two shining oceans",
   photos:[{f:"Moraine_Lake_17092005.jpg",cap:"Moraine Lake · Banff National Park"},{f:"Lake_Louise_in_Banff_National_Park,_boat_view_2.jpg",cap:"Lake Louise · Alberta Rockies"},{f:"Toronto_Skyline_from_Snake_Island,_February_28_2026_(08).jpg",cap:"Toronto skyline & CN Tower"},{f:"Skyline_of_Vancouver,_Canada.jpg",cap:"Vancouver · mountains meet sea"},{f:"3Falls_Niagara.jpg",cap:"Niagara Falls · Ontario"},{f:"Château_Frontenac_02.jpg",cap:"Château Frontenac · Old Québec City"},{f:"Ottawa_-_ON_-_Stadtansicht.jpg",cap:"Parliament Hill · Ottawa"},{f:"Montreal,_Quebec_skyline.jpg",cap:"Montréal skyline · Québec"},{f:"Peggys_Cove_Harbour_01.jpg",cap:"Peggy's Cove · Nova Scotia coast"},{f:"Aurora Borealis (47533341121).jpg",cap:"Northern lights · Whitehorse, Yukon"}],
   video:{id:"Gl7m0cVa37k",title:"10 Days in Canada Vlog - Banff, Lake Louise, Jasper",by:"Suitcase Monkey"},
   cities:[{name:"Ottawa",lng:-75.70,lat:45.42,capital:true},{name:"Toronto",lng:-79.38,lat:43.65},{name:"Montréal",lng:-73.57,lat:45.50},{name:"Vancouver",lng:-123.12,lat:49.28},{name:"Calgary",lng:-114.07,lat:51.05},{name:"Edmonton",lng:-113.49,lat:53.55},{name:"Québec City",lng:-71.21,lat:46.81},{name:"Winnipeg",lng:-97.14,lat:49.90}],
   maps:"https://www.google.com/maps/place/Canada/@56.1,-106.3,4z",
   facts:{capital:"Ottawa",population:"≈ 41.5 million (2024)",languages:"English & French (official)",langCount:"≈ 200+ languages spoken in total",independence:"July 1, 1867 — Confederation; full sovereignty via the Statute of Westminster (1931)",government:"Federal parliamentary constitutional monarchy",etymology:"From the St. Lawrence Iroquoian <em>kanata</em> — \"village\" or \"settlement.\""},
   people:[{n:"Sir John A. Macdonald",r:"first Prime Minister — father of Confederation",img:"John_A_Macdonald_(ca._1875).jpg"},{n:"Sir Wilfrid Laurier",r:"first French-Canadian PM — nation-builder",img:"The_Honourable_Sir_Wilfrid_Laurier_Photo_A_(3x4_cropped).jpg"},{n:"Louis Riel",r:"Métis leader — founder of Manitoba",img:"Louis_Riel.jpg"},{n:"Tommy Douglas",r:"father of Canadian universal healthcare",img:"Premier_Tommy_Douglas_(F1257_s1057_it2743).jpg"},{n:"Terry Fox",r:"Marathon of Hope — national icon",img:"TerryFoxToronto19800712.JPG"}],
   art:{n:"Emily Carr",r:"Painter of West Coast forests",img:"Emily_Carr_(I0007935).jpg"}, writer:{n:"Margaret Atwood",r:"Author of The Handmaid's Tale",img:"Margaret_Atwood_(3x4_cropped).jpg"}, stage:{n:"Ryan Gosling",r:"Acclaimed Hollywood leading man",img:"GoslingBFI081223_(22_of_30)_(53388157347)_(cropped).jpg"}, music:{n:"Céline Dion",r:"one of the best-selling artists of all time",img:"Céline_Dion_2012.jpg"},
   sports:{n:"Wayne Gretzky",r:"\"The Great One\" — hockey's greatest scorer",img:"Andrew_Scheer_with_Wayne_Gretzky_(48055697168)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Canada"},{label:"Facts & figures",detail:"Wikipedia — \"Canada\" & related articles",url:"https://en.wikipedia.org/wiki/Canada"},{label:"Travel film",detail:"YouTube — \"10 Days in Canada Vlog\" · Suitcase Monkey",url:"https://www.youtube.com/watch?v=Gl7m0cVa37k"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Canada/@56.1,-106.3,4z"}] },
  AU: { tagline:"The Land Down Under · sunburnt country, boundless plains",
   photos:[{f:"Sydney_Opera_House_and_Harbour_Bridge_Dusk_(2)_2019-06-21.jpg",cap:"Opera House & Harbour Bridge · Sydney"},{f:"Uluru.jpg",cap:"Uluru · Red Centre"},{f:"ISS-45_StoryOfWater,_Great_Barrier_Reef,_Australia.jpg",cap:"Great Barrier Reef · from orbit"},{f:"The_Twelve_Apostles_2011.jpg",cap:"Twelve Apostles · Great Ocean Road"},{f:"Melbourne_skyline_sor.jpg",cap:"Melbourne skyline · Victoria"},{f:"Bondi_from_above.jpg",cap:"Bondi Beach · Sydney"},{f:"Three_Sisters_Sunset.jpg",cap:"Three Sisters · Blue Mountains"},{f:"Flinders_Chase_National_Park_01.jpg",cap:"Flinders Chase · Kangaroo Island"},{f:"Whitehaven_Beach,_Whitsunday_Island,_Queensland.jpg",cap:"Whitehaven Beach · Whitsundays"},{f:"A192,_Port_Campbell_National_Park,_Australia,_Twelve_Apostles_sea_stacks_from_helicopter,_2007.JPG",cap:"Port Campbell coast · Victoria"}],
   video:{id:"-dEsZOFoZI8",title:"Australia in 10 days: Melbourne, Sydney, Cairns, Uluru",by:"Travel-Notes"},
   cities:[{name:"Canberra",lng:149.13,lat:-35.28,capital:true},{name:"Sydney",lng:151.21,lat:-33.87},{name:"Melbourne",lng:144.96,lat:-37.81},{name:"Brisbane",lng:153.03,lat:-27.47},{name:"Perth",lng:115.86,lat:-31.95},{name:"Adelaide",lng:138.60,lat:-34.93},{name:"Gold Coast",lng:153.43,lat:-28.00},{name:"Darwin",lng:130.84,lat:-12.46}],
   maps:"https://www.google.com/maps/place/Australia/@-25.27,133.77,4z",
   facts:{capital:"Canberra",population:"≈ 27.2 million (2024)",languages:"English (de facto national); 150+ Indigenous languages",langCount:"≈ 300+ languages spoken in total",independence:"Jan 1, 1901 — Federation; full sovereignty via Statute of Westminster (1942) & Australia Act (1986)",government:"Federal parliamentary constitutional monarchy",etymology:"From Latin <em>terra australis</em> — \"the <em>southern land</em>.\""},
   people:[{n:"Edmund Barton",r:"Australia's first Prime Minister, 1901",img:"Edmund_Barton_-_Swiss_Studios_(b&w).jpg"},{n:"Sir Henry Parkes",r:"the \"Father of Federation\"",img:"Henryparkes.jpg"},{n:"Captain James Cook",r:"charted the east coast in 1770",img:"Captainjamescookportrait.jpg"},{n:"Ned Kelly",r:"armour-clad bushranger & folk legend",img:"Ned_Kelly_in_1880.png"},{n:"Edith Cowan",r:"first woman elected to an Australian parliament",img:"Edith_Cowan_1900.jpg"}],
   art:{n:"Sidney Nolan",r:"Painter of Ned Kelly series",img:"Portrait_of_Sidney_Nolan.jpg"}, writer:{n:"Patrick White",r:"Nobel laureate novelist",img:"Patrick_White_writer.jpg"}, stage:{n:"Cate Blanchett",r:"Acclaimed film and stage actor",img:"Cate_Blanchett-63298_(cropped_2).jpg"}, music:{n:"AC/DC",r:"one of the best-selling rock bands ever",img:"AC_DC_Black_Ice_Tour_2009_Buenos_Aires_4_de_Diciembre_(4238680962).jpg"},
   sports:{n:"Cathy Freeman",r:"Olympic 400m champion — Sydney 2000",img:"Cathy_Freeman_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Australia"},{label:"Facts & figures",detail:"Wikipedia — \"Australia\" & related articles",url:"https://en.wikipedia.org/wiki/Australia"},{label:"Travel film",detail:"YouTube — \"Australia in 10 days\" · Travel-Notes",url:"https://www.youtube.com/watch?v=-dEsZOFoZI8"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Australia/@-25.27,133.77,4z"}] },
  DE: { tagline:"Deutschland · the beating heart of Europe",
   photos:[{f:"Schloss_Neuschwanstein_2013.jpg",cap:"Neuschwanstein Castle · Bavaria"},{f:"Brandenburger_Tor_abends.jpg",cap:"Brandenburg Gate · Berlin"},{f:"Kölner_Dom_-_Westfassade_2022_ohne_Gerüst-0968_b.jpg",cap:"Cologne Cathedral · Köln"},{f:"Rathaus_and_Marienplatz_from_Peterskirche_-_August_2006.jpg",cap:"Marienplatz · Munich"},{f:"O'zapft_is!_Münchens_5_Jahreszeit_hat_begonnen_-_O'zapft_is!_Munich_5_season,_the_Oktoberfest_has_begun_(9855483374).jpg",cap:"Oktoberfest · Munich"},{f:"Bayerische_Alpen.JPG",cap:"The Bavarian Alps"},{f:"St.Goarshausen_Loreley_Burg_Katz_2016-03-27-17-13-57.jpg",cap:"Burg Katz & the Loreley · Rhine Valley"},{f:"Speicherstadt_abends.jpg",cap:"Speicherstadt · Hamburg"},{f:"Blick_vom_Hohfelsen.jpg",cap:"The Black Forest"},{f:"Königstuhl,_Heidelberg,_U-17.jpg",cap:"Heidelberg · the Neckar"}],
   video:{id:"8DR3homwIrY",title:"5 Must-sees in Germany",by:"DW Travel"},
   cities:[{name:"Berlin",lng:13.40,lat:52.52,capital:true},{name:"Hamburg",lng:9.99,lat:53.55},{name:"Munich",lng:11.58,lat:48.14},{name:"Cologne",lng:6.96,lat:50.94},{name:"Frankfurt",lng:8.68,lat:50.11},{name:"Stuttgart",lng:9.18,lat:48.78},{name:"Düsseldorf",lng:6.78,lat:51.23},{name:"Dresden",lng:13.74,lat:51.05}],
   maps:"https://www.google.com/maps/place/Germany/@51.2,10.4,5z",
   facts:{capital:"Berlin",population:"≈ 84.7 million (2024)",languages:"German (official); Sorbian, Danish, Frisian & Romani recognized",langCount:"≈ 20+ languages spoken in total",independence:"Jan 18, 1871 — unification of the German Empire; reunified Oct 3, 1990",government:"Federal parliamentary republic",etymology:"English \"Germany\" from Latin <em>Germania</em>; German <em>Deutschland</em> from <em>diutisc</em>, \"of the people.\""},
   people:[{n:"Otto von Bismarck",r:"\"Iron Chancellor\" — unifier of Germany",img:"Otto_von_Bismarck_1885_(cropped).jpg"},{n:"Martin Luther",r:"friar who sparked the Protestant Reformation",img:"Lucas_Cranach_d.Ä._-_Martin_Luther,_1528_(Veste_Coburg).jpg"},{n:"Johann Wolfgang von Goethe",r:"poet & polymath — author of Faust",img:"Goethe_(Stieler_1828).jpg"},{n:"Albert Einstein",r:"physicist — theory of relativity",img:"Albert_Einstein_Head_cleaned.jpg"},{n:"Konrad Adenauer",r:"first postwar West German chancellor",img:"Bundesarchiv_B_145_Bild-F078072-0004,_Konrad_Adenauer.jpg"}],
   art:{n:"Albrecht Dürer",r:"Renaissance printmaker and painter",img:"Dürer_Alte_Pinakothek.jpg"}, writer:{n:"Johann Wolfgang von Goethe",r:"Poet of Faust",img:"Goethe_(Stieler_1828).jpg"}, stage:{n:"Marlene Dietrich",r:"Iconic screen and cabaret actor",img:"Marlene_Dietrich_in_No_Highway_(1951)_(Cropped).png"}, music:{n:"Ludwig van Beethoven",r:"towering composer — bridge to the Romantic era",img:"Joseph_Karl_Stieler's_Beethoven_mit_dem_Manuskript_der_Missa_solemnis.jpg"},
   sports:{n:"Michael Schumacher",r:"7× Formula 1 world champion",img:"Aécio_Neves,_Michael_Schumacher_e_Didi_(Cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Germany"},{label:"Facts & figures",detail:"Wikipedia — \"Germany\" & related articles",url:"https://en.wikipedia.org/wiki/Germany"},{label:"Travel film",detail:"YouTube — \"5 Must-sees in Germany\" · DW Travel",url:"https://www.youtube.com/watch?v=8DR3homwIrY"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Germany/@51.2,10.4,5z"}] },
  PT: { tagline:"Terra à beira-mar plantada · where Europe meets the Atlantic",
   photos:[{f:"Lisboa_-_Portugal_(52597836992).jpg",cap:"Lisbon skyline · the city of seven hills"},{f:"Torre_Belém_April_2009-4a.jpg",cap:"Belém Tower · Lisbon"},{f:"Lisbon_alfalma.jpg",cap:"Alfama · Lisbon's oldest quarter"},{f:"Dom_Luís_I_Bridge_(36961760686).jpg",cap:"Dom Luís I Bridge · Porto"},{f:"Puente_Don_Luis_I,_Oporto,_Portugal,_2012-05-09,_DD_13.JPG",cap:"Ribeira riverfront · Porto"},{f:"Sintra_-_Palacio_da_Pena_(20332995770)_(cropped2).jpg",cap:"Pena Palace · Sintra"},{f:"Praia_de_Benagil_-_Portugal_🇵🇹_(53651979938).jpg",cap:"Benagil sea cave · the Algarve"},{f:"Rio_Douro_-_Portugal_(32615481975)_(cropped).jpg",cap:"Terraced vineyards · the Douro Valley"},{f:"Ponta_de_São_Lourenço_north_north_east.jpg",cap:"Ponta de São Lourenço · Madeira"},{f:"Óbidos_view592.jpg",cap:"Whitewashed walls · Óbidos"}],
   video:{id:"JBCXQUGtPWg",title:"Discover Wonders of Portugal | 4K",by:"Travel Pulse TV"},
   cities:[{name:"Lisbon",lng:-9.14,lat:38.72,capital:true},{name:"Porto",lng:-8.61,lat:41.15},{name:"Braga",lng:-8.43,lat:41.55},{name:"Coimbra",lng:-8.43,lat:40.21},{name:"Faro",lng:-7.93,lat:37.02},{name:"Funchal",lng:-16.91,lat:32.65},{name:"Aveiro",lng:-8.65,lat:40.64},{name:"Évora",lng:-7.91,lat:38.57}],
   maps:"https://www.google.com/maps/place/Portugal/@39.5,-8,6z",
   facts:{capital:"Lisbon (Lisboa)",population:"≈ 10.6 million (2024)",languages:"Portuguese (official); Mirandese (co-official)",langCount:"≈ 5 languages spoken in total",independence:"1143 — from León (Treaty of Zamora); republic since 1910",government:"Unitary semi-presidential republic",etymology:"From <em>Portus Cale</em>, the Roman-era port at the mouth of the <em>Douro</em>."},
   people:[{n:"Afonso Henriques",r:"first king — founder of Portugal",img:"D._Afonso_Henriques_-_Compendio_de_crónicas_de_reyes_(Biblioteca_Nacional_de_España).png"},{n:"Vasco da Gama",r:"navigator — first sea route to India",img:"Ignoto_portoghese,_ritratto_di_un_cavaliere_dell'ordine_di_cristo,_1525-50_ca._02.jpg"},{n:"Prince Henry the Navigator",r:"patron of the Age of Discovery",img:"Henry_the_Navigator1.jpg"},{n:"Luís de Camões",r:"national poet — author of Os Lusíadas",img:"Camões,_por_Fernão_Gomes.jpg"},{n:"Fernando Pessoa",r:"modernist poet of many heteronyms",img:"Pessoa_chapeu.jpg"}],
   art:{n:"Paula Rego",r:"Bold figurative painter",img:""}, writer:{n:"Fernando Pessoa",r:"Modernist poet of heteronyms",img:"Pessoa_chapeu.jpg"}, stage:{n:"Joaquim de Almeida",r:"Widely cast film actor",img:"Joaquim_de_Almeida.jpg"}, music:{n:"Amália Rodrigues",r:"the \"Queen of Fado\"",img:"Amália_Rodrigues_('Fado_et_Flamenco',_Columbia,_1956),_cropped.png"},
   sports:{n:"Cristiano Ronaldo",r:"5× Ballon d'Or — football icon",img:"Cristiano_Ronaldo_2275_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Portugal"},{label:"Facts & figures",detail:"Wikipedia — \"Portugal\" & related articles",url:"https://en.wikipedia.org/wiki/Portugal"},{label:"Travel film",detail:"YouTube — \"Discover Wonders of Portugal | 4K\" · Travel Pulse TV",url:"https://www.youtube.com/watch?v=JBCXQUGtPWg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Portugal/@39.5,-8,6z"}] },
  GR: { tagline:"Ελλάς · where the West wrote its first chapter",
   photos:[{f:"The_Parthenon_in_Athens.jpg",cap:"The Parthenon · Acropolis of Athens"},{f:"Oia_-_Santorini_2019.jpg",cap:"Whitewashed Oia · Santorini"},{f:"Chora_Windmills,_Mykonos,_Greece_(53507028405).jpg",cap:"The windmills of Chora · Mykonos"},{f:"Meteora's_monastery_2.jpg",cap:"Cliff-top monasteries · Metéora"},{f:"Delphi,_Greece_-_panoramio.jpg",cap:"Ancient Delphi · navel of the world"},{f:"1007_Bourtzi_Castle_in_Nafplio_Photo_by_Giles_Laurent.jpg",cap:"Bourtzi fortress · Nafplio"},{f:"Rhodes_at_dusk_from_the_pier_2010.jpg",cap:"Medieval old town at dusk · Rhodes"},{f:"Navagio,_Zante_01.jpg",cap:"Navagio (Shipwreck) Beach · Zákynthos"},{f:"Island_of_Crete,_Greece.JPG",cap:"Rugged coastline · Crete"},{f:"Elounda_02.jpg",cap:"Turquoise bays of Elounda · Crete"}],
   video:{id:"AKGkbdILcjU",title:"Top 10 Greek Islands To Visit",by:"Ryan Shirley"},
   cities:[{name:"Athens",lng:23.73,lat:37.98,capital:true},{name:"Thessaloniki",lng:22.94,lat:40.64},{name:"Patras",lng:21.73,lat:38.25},{name:"Heraklion",lng:25.13,lat:35.34},{name:"Larissa",lng:22.42,lat:39.64},{name:"Rhodes",lng:28.22,lat:36.44},{name:"Chania",lng:24.02,lat:35.51}],
   maps:"https://www.google.com/maps/place/Greece/@39,22,6z",
   facts:{capital:"Athens (Αθήνα)",population:"≈ 10.4 million (2024)",languages:"Greek (official)",langCount:"≈ 12 languages spoken in total",independence:"Mar 25, 1821 — declared from the Ottoman Empire (recognized 1830)",government:"Unitary parliamentary republic",etymology:"English <em>Greece</em> comes from Latin <em>Graecia</em>; the Greek name is <em>Hellas</em> (Ελλάς)."},
   people:[{n:"Alexander the Great",r:"king who forged an empire to India",img:"Alexander_Mosaic_detail_of_Alexander_the_Great_(3x4_cropped).jpg"},{n:"Socrates",r:"father of Western philosophy",img:"Socrates_Louvre.jpg"},{n:"Aristotle",r:"polymath who shaped Western thought",img:"Aristotle_Altemps_Inv8575.jpg"},{n:"Homer",r:"poet of the Iliad and Odyssey",img:"Homer_At_the_British_Museum_2024_(3x4_cropped).jpg"},{n:"Pericles",r:"statesman of Athens' Golden Age",img:"Pericles_Pio-Clementino_Inv269_n2.jpg"}],
   art:{n:"El Greco",r:"Elongated Mannerist painter",img:"El_Greco_-_Portrait_of_a_Man_-_WGA10554.jpg"}, writer:{n:"Nikos Kazantzakis",r:"Novelist behind Zorba",img:"Nikos_Kazantzakis_1904.jpg"}, stage:{n:"Melina Mercouri",r:"Actress and culture minister",img:"Melina_Mercouri.JPG"}, music:{n:"Mikis Theodorakis",r:"composer of \"Zorba the Greek\"",img:"Mikis_Theodorakis_Fabrik_070004.jpg"},
   sports:{n:"Giannis Antetokounmpo",r:"NBA champion & 2× MVP — the \"Greek Freak\"",img:"Giannis_Antetokounmpo_(51915153421)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Greece"},{label:"Facts & figures",detail:"Wikipedia — \"Greece\" & related articles",url:"https://en.wikipedia.org/wiki/Greece"},{label:"Travel film",detail:"YouTube — \"Top 10 Greek Islands To Visit\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=AKGkbdILcjU"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Greece/@39,22,6z"}] },
  NL: { tagline:"Nederland · the low country that engineered its own map",
   photos:[{f:"Amsterdam Prinsengracht Wallpaper.jpg",cap:"Prinsengracht canal · Amsterdam"},{f:"The windmills of Kinderdijk.JPG",cap:"Windmills of Kinderdijk"},{f:"Tulip garden Keukenhof 1.jpg",cap:"Tulip fields · Keukenhof"},{f:"Cube houses (DSC 3076).jpg",cap:"Cube Houses · Rotterdam"},{f:"Binnenhof, The Hague 1834.jpg",cap:"Binnenhof · The Hague"},{f:"Giethoorn (11053086563).jpg",cap:"Giethoorn · the village of canals"},{f:"The Windmills of Zaanse Schans, Netherlands.jpg",cap:"Zaanse Schans windmills"},{f:"Oudegracht (old canal) in Utrecht.jpg",cap:"Oudegracht · Utrecht"},{f:"Dutch polder landscape (20313246535).jpg",cap:"Polder countryside"},{f:"Erasmus bridge and Rotterdam skyline (21458216300).jpg",cap:"Erasmusbrug & skyline · Rotterdam"}],
   video:{id:"kwYczEUr9Fg",title:"Netherlands Travel Guide - Best Cities to Visit",by:"Travel Ranked"},
   cities:[{name:"Amsterdam",lng:4.90,lat:52.37,capital:true},{name:"Rotterdam",lng:4.48,lat:51.92},{name:"The Hague",lng:4.30,lat:52.08},{name:"Utrecht",lng:5.12,lat:52.09},{name:"Eindhoven",lng:5.48,lat:51.44},{name:"Groningen",lng:6.57,lat:53.22},{name:"Maastricht",lng:5.69,lat:50.85}],
   maps:"https://www.google.com/maps/place/Netherlands/@52.1,5.3,7z",
   facts:{capital:"Amsterdam (seat of government in The Hague)",population:"≈ 18.0 million (2024)",languages:"Dutch (official); Frisian co-official in Friesland",langCount:"≈ 15 languages spoken in total",independence:"July 26, 1581 — Act of Abjuration from Spain; recognized 1648 (Peace of Westphalia)",government:"Unitary parliamentary constitutional monarchy",etymology:"Dutch <em>Nederland</em> — the \"low country/lands\", most of it near or below sea level."},
   people:[{n:"William the Silent",r:"father of the Dutch fatherland — led the revolt",img:"William_I,_Prince_of_Orange_by_Adriaen_Thomasz._Key_Rijksmuseum_Amsterdam_SK-A-3148.jpg"},{n:"Rembrandt",r:"master painter of the Dutch Golden Age",img:"Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.jpg"},{n:"Vincent van Gogh",r:"post-Impressionist painter — global icon",img:"Vincent_van_Gogh_-_Self-Portrait_-_Google_Art_Project_(454045).jpg"},{n:"Baruch Spinoza",r:"Enlightenment philosopher — rationalist pioneer",img:"Spinoza.jpg"},{n:"Anne Frank",r:"diarist — voice of the Holocaust",img:"Anne_Frank_passport_photo,_May_1942_(cropped).jpg"}],
   art:{n:"Vincent van Gogh",r:"Post-Impressionist painter of sunflowers",img:"Vincent_van_Gogh_-_Self-Portrait_-_Google_Art_Project_(454045).jpg"}, writer:{n:"Anne Frank",r:"Diarist of the Holocaust",img:"Anne_Frank_passport_photo,_May_1942_(cropped).jpg"}, stage:{n:"Rutger Hauer",r:"Intense Blade Runner actor",img:"Rutger_Hauer_(2018).jpg"}, music:{n:"André Rieu",r:"\"King of the Waltz\" — world's top touring maestro",img:"Andre_Rieu_2010.jpg"},
   sports:{n:"Johan Cruyff",r:"Total Football legend — reinvented the game",img:"Johan_Cruijff_(1974).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Netherlands"},{label:"Facts & figures",detail:"Wikipedia — \"Netherlands\" & related articles",url:"https://en.wikipedia.org/wiki/Netherlands"},{label:"Travel film",detail:"YouTube — \"Netherlands Travel Guide\" · Travel Ranked",url:"https://www.youtube.com/watch?v=kwYczEUr9Fg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Netherlands/@52.1,5.3,7z"}] },
  ZA: { tagline:"iRhawuti · a whole world in one country",
   photos:[{f:"Camps_bay_(53460319478)_(cropped).jpg",cap:"Camps Bay & Table Mountain · Cape Town"},{f:"Table_Mountain_DanieVDM.jpg",cap:"Table Mountain rising over the city"},{f:"Playa_Dias,_Cape_Point,_Sudáfrica,_2018-07-23,_DD_103.jpg",cap:"Cape of Good Hope · where two oceans meet"},{f:"Kruger_Zebra.JPG",cap:"Zebra on safari · Kruger National Park"},{f:"20131119_162543b.jpg",cap:"Blyde River Canyon · the Panorama Route"},{f:"Tsitsikamma_Park.JPG",cap:"Tsitsikamma coast · the Garden Route"},{f:"Johannesburg_skyline_2017.jpg",cap:"Johannesburg skyline · the City of Gold"},{f:"South_Africa_-_Drakensberg_(16261357780).jpg",cap:"The Drakensberg · the Dragon Mountains"},{f:"Boulders_Beach_Suedafrika.jpg",cap:"African penguins · Boulders Beach"},{f:"Knysna_waterfront.jpg",cap:"Knysna lagoon · Garden Route jewel"}],
   video:{id:"ITuxoCwt060",title:"South Africa Travel Documentary - the Garden Route [4K]",by:"lostintravel.at"},
   cities:[{name:"Pretoria",lng:28.19,lat:-25.75,capital:true},{name:"Cape Town",lng:18.42,lat:-33.92},{name:"Bloemfontein",lng:26.21,lat:-29.12},{name:"Johannesburg",lng:28.05,lat:-26.20},{name:"Durban",lng:31.02,lat:-29.86},{name:"Gqeberha (Port Elizabeth)",lng:25.60,lat:-33.96},{name:"East London",lng:27.91,lat:-33.02}],
   maps:"https://www.google.com/maps/place/South+Africa/@-30,25,5z",
   facts:{capital:"Pretoria (executive) · Cape Town · Bloemfontein",population:"≈ 62 million (2024)",languages:"12 official — Zulu, Xhosa, Afrikaans, English & more",langCount:"≈ 35 languages spoken in total",independence:"May 31, 1910 — Union of South Africa; republic 1961; democratic 1994",government:"Unitary parliamentary republic",etymology:"Named for its geographic position at the <em>southern tip of Africa</em>."},
   people:[{n:"Nelson Mandela",r:"anti-apartheid icon — first democratic president",img:"Nelson_Mandela_1994.jpg"},{n:"Desmond Tutu",r:"archbishop & Nobel Peace laureate",img:"Archbishop-Tutu-medium.jpg"},{n:"Steve Biko",r:"martyred Black Consciousness leader",img:"Steve_Biko_on_Flyer_for_Steve_Biko_Memorial_at_the_Carver_Cultural_Center.jpg"},{n:"Oliver Tambo",r:"longtime ANC president in exile",img:"Oliver_Tambo_(1981).jpg"},{n:"Shaka Zulu",r:"founding king of the Zulu nation",img:"KingShaka.jpg"}],
   art:{n:"William Kentridge",r:"Charcoal animation and drawing artist",img:"William_Kentridge_(2025).jpg"}, writer:{n:"J. M. Coetzee",r:"Nobel laureate novelist",img:"J._M._Coetzee_Nov_2023_headshot.jpg"}, stage:{n:"Charlize Theron",r:"Oscar-winning film actor",img:"Charlize-theron-IMG_6045.jpg"}, music:{n:"Miriam Makeba",r:"\"Mama Africa\" — Grammy-winning global voice",img:"Miriam_makeba_01.jpg"},
   sports:{n:"Siya Kolisi",r:"first Black Springbok captain — 2× World Cup winner",img:"Siya_Kolisi_2022.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:South_Africa"},{label:"Facts & figures",detail:"Wikipedia — \"South Africa\" & related articles",url:"https://en.wikipedia.org/wiki/South_Africa"},{label:"Travel film",detail:"YouTube — \"South Africa Travel Documentary\" · lostintravel.at",url:"https://www.youtube.com/watch?v=ITuxoCwt060"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/South+Africa/@-30,25,5z"}] },
  TR: { tagline:"Where East meets West · two continents, one soul",
   photos:[{f:"Hagia_Sophia_(228968325).jpeg",cap:"Hagia Sophia · Istanbul"},{f:"Blue-Mosque-Istanbul-October-2012.jpg",cap:"The Blue Mosque · Istanbul"},{f:"Bosphorus, aerial view - Turkey - panoramio.jpg",cap:"The Bosphorus splitting two continents"},{f:"Cappadocia balloon trip, Ortahisar Castle (11893715185).jpg",cap:"Balloons over Cappadocia's fairy chimneys"},{f:"Pamukkale, Denizli 2026 68.jpg",cap:"Pamukkale's travertine terraces"},{f:"Ephesus Celsus Library Façade.jpg",cap:"Library of Celsus · ancient Ephesus"},{f:"Falezlerden Antalya Konyaaltı Plajına doğru bir görünüm.jpg",cap:"Konyaaltı coast · Antalya"},{f:"Ankara from bus station.jpg",cap:"The capital · Ankara"},{f:"Sunset over Bodrum I.jpg",cap:"Sunset over Bodrum"},{f:"Mount Nemrut - East Terrace (4961323529).jpg",cap:"Giant stone heads · Mount Nemrut"}],
   video:{id:"e9mtvvJM0yg",title:"How to travel Turkey | The perfect 14-day guide",by:"Rhett and Claire"},
   cities:[{name:"Ankara",lng:32.85,lat:39.93,capital:true},{name:"Istanbul",lng:28.98,lat:41.01},{name:"Izmir",lng:27.14,lat:38.42},{name:"Bursa",lng:29.06,lat:40.19},{name:"Antalya",lng:30.71,lat:36.90},{name:"Adana",lng:35.32,lat:37.00},{name:"Konya",lng:32.49,lat:37.87},{name:"Gaziantep",lng:37.38,lat:37.07}],
   maps:"https://www.google.com/maps/place/Turkey/@39,35,6z",
   facts:{capital:"Ankara",population:"≈ 85.3 million (2024)",languages:"Turkish (official); Kurdish, Arabic & Zaza also spoken",langCount:"≈ 35 languages spoken in total",independence:"Oct 29, 1923 — Republic proclaimed (from the Ottoman Empire)",government:"Unitary presidential republic",etymology:"From <em>Türk</em> + the Latin suffix <em>-ia</em> — \"land of the Turks.\""},
   people:[{n:"Mustafa Kemal Atatürk",r:"founder & first president of the Republic",img:"Portret_van_de_Turkse_leider_Mustafa_Kemal_Ataturk_(Atatürk_Kemal_Pascha)_(1881-1938)_in_westers,_SFA003017837.jpg"},{n:"Mehmed the Conqueror",r:"sultan who took Constantinople in 1453",img:"Bellini, Gentile - Sultan Mehmet II.jpg"},{n:"Suleiman the Magnificent",r:"longest-reigning Ottoman sultan — golden age",img:"EmperorSuleiman.jpg"},{n:"Rumi (Mevlânâ)",r:"13th-century Sufi poet & mystic",img:"مولانا اثر حسین بهزاد (cropped).jpg"},{n:"Mimar Sinan",r:"master Ottoman architect of the empire",img:"Mimar Sinan, architecte de Soliman le Magnifique.jpg"}],
   art:{n:"Osman Hamdi Bey",r:"Painter of The Tortoise Trainer",img:"Osman_Hamdi_Bey.jpg"}, writer:{n:"Orhan Pamuk",r:"Nobel laureate novelist",img:"Orhan_Pamuk_2009_Shankbone.jpg"}, stage:{n:"Haluk Bilginer",r:"Emmy-winning stage-screen actor",img:"Haluk_Bilginer2022.jpg"}, music:{n:"Tarkan",r:"pop superstar — the \"Prince of the Bosphorus\"",img:"Tarkan (9).jpg"},
   sports:{n:"Naim Süleymanoğlu",r:"\"Pocket Hercules\" — 3× Olympic weightlifting champion",img:"N Sul.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Turkey"},{label:"Facts & figures",detail:"Wikipedia — \"Turkey\" & related articles",url:"https://en.wikipedia.org/wiki/Turkey"},{label:"Travel film",detail:"YouTube — \"How to travel Turkey\" · Rhett and Claire",url:"https://www.youtube.com/watch?v=e9mtvvJM0yg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Turkey/@39,35,6z"}] },
  TH: { tagline:"Prathet Thai · land of the free, the Kingdom of Siam",
   photos:[{f:"0005574_-_Wat_Phra_Kaew_006.jpg",cap:"Grand Palace · Bangkok"},{f:"Templo_Wat_Arun,_Bangkok,_Tailandia,_2013-08-22,_DD_40.jpg",cap:"Wat Arun · Temple of Dawn"},{f:"Wat_Phra_Kaew_by_Ninara_TSP_edit_crop.jpg",cap:"Wat Phra Kaew · the Emerald Buddha"},{f:"Wat_Phra_That_Doi_Suthep_-_Chiang_Mai.jpg",cap:"Doi Suthep · Chiang Mai"},{f:"KohPhiPhi.JPG",cap:"Phi Phi Islands · Andaman Sea"},{f:"Ayutthaya_World_Heritage_sign.jpg",cap:"Ayutthaya · old capital ruins"},{f:"Railay_Beach_5.jpg",cap:"Railay Beach · Krabi"},{f:"Damnoen_Saduak_Floating_Market_1977_-_panoramio.jpg",cap:"Floating market · Damnoen Saduak"},{f:"Wat_srichum_03.jpg",cap:"Sukhothai · Wat Si Chum"},{f:"Phuket_Aerial.jpg",cap:"Phuket · Andaman coast"}],
   video:{id:"omojFXTxis0",title:"TOP 10 THAILAND (THE BEST OF THAILAND)",by:"Lost LeBlanc"},
   cities:[{name:"Bangkok",lng:100.49,lat:13.75,capital:true},{name:"Nonthaburi",lng:100.52,lat:13.85},{name:"Nakhon Ratchasima",lng:102.10,lat:14.97},{name:"Chiang Mai",lng:98.99,lat:18.79},{name:"Hat Yai",lng:100.47,lat:7.02},{name:"Udon Thani",lng:102.75,lat:17.42},{name:"Pattaya",lng:100.89,lat:12.94},{name:"Phuket",lng:98.39,lat:7.88}],
   maps:"https://www.google.com/maps/place/Thailand/@15,101,6z",
   facts:{capital:"Bangkok (Krung Thep)",population:"≈ 72 million (2024)",languages:"Thai (official) · Isan, Malay, Karen also spoken",langCount:"≈ 70+ languages spoken in total",independence:"Never colonized — kingdom unified 1238 (Sukhothai); constitutional monarchy since 1932",government:"Unitary parliamentary constitutional monarchy",etymology:"From <em>Thai</em> (\"free\") + <em>land</em> — \"land of the free.\" Formerly <em>Siam</em>."},
   people:[{n:"King Ramkhamhaeng",r:"Sukhothai king — created the Thai alphabet",img:"Ram_Khamhaeng_the_Great_(I).jpg"},{n:"King Naresuan",r:"warrior king who freed Siam from Burma",img:"KingNU.jpg"},{n:"King Mongkut (Rama IV)",r:"modernizer who opened Siam to the West",img:"First_King_of_Siam_MET_DP-573-001_(cropped).jpg"},{n:"King Chulalongkorn (Rama V)",r:"abolished slavery — kept Siam independent",img:"Chulalongkorn_LoC.jpg"},{n:"King Bhumibol (Rama IX)",r:"longest-reigning monarch — beloved father of the nation",img:"Aankomst_Koning_Bhumibol_en_Koningin_Sirikit_te_Den_Haag,_Koning_Bhumibol,_Bestanddeelnr_911-6993_(cropped)(2).jpg"}],
   art:{n:"Chalermchai Kositpipat",r:"Painter of the White Temple",img:"Chalermchai_Kositpipat_(June_2021)_-_03.jpg"}, writer:{n:"Sunthorn Phu",r:"Revered classical poet",img:"วัดเทพธิดารามวรวิหาร_เขตพระนคร_กรุงเทพมหานคร_(28).jpg"}, stage:{n:"Tony Jaa",r:"Martial-arts action film star",img:"Tony_Jaa_2005.jpg"}, music:{n:"Tata Young",r:"Thailand's biggest international pop crossover star",img:"Tata_young_pimf_2007.JPG"},
   sports:{n:"Ratchanok Intanon",r:"first Thai badminton world champion",img:"Ratchanok_Intanon_Indonesia_Masters_2025.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Thailand"},{label:"Facts & figures",detail:"Wikipedia — \"Thailand\" & related articles",url:"https://en.wikipedia.org/wiki/Thailand"},{label:"Travel film",detail:"YouTube — \"TOP 10 THAILAND\" · Lost LeBlanc",url:"https://www.youtube.com/watch?v=omojFXTxis0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Thailand/@15,101,6z"}] },
  PE: { tagline:"Land of the Incas · where the Andes meet the Amazon",
   photos:[{f:"Machu Picchu, 2023 (012).jpg",cap:"Machu Picchu · the lost Inca citadel"},{f:"Vista Calle Suecia.jpg",cap:"Cusco · ancient Inca capital"},{f:"Sacsayhuamán, Cusco, Perú, 2015-07-31, DD 27.JPG",cap:"Sacsayhuamán · megalithic fortress above Cusco"},{f:"Montañaarcoirisperuabanto.jpg",cap:"Vinicunca · the Rainbow Mountain"},{f:"Miraflores 2023.jpg",cap:"Miraflores · Lima's Pacific cliffs"},{f:"Basílica Catedral Metropolitana de Lima (cropped).jpg",cap:"Lima · the colonial historic center"},{f:"Islas flotantes de los Uros, Lago Titicaca, Perú, 2015-08-01, DD 37.JPG",cap:"Uros floating islands · Lake Titicaca"},{f:"Colca Canyon Puno.jpg",cap:"Colca Canyon · realm of the condor"},{f:"Líneas de Nazca, Nazca, Perú, 2015-07-29, DD 49.JPG",cap:"Nazca Lines · giant desert geoglyphs"},{f:"Laguna Wilcacocha 03.jpg",cap:"Cordillera Blanca · the white Andes"}],
   video:{id:"AHBz5CkQAr8",title:"The Perfect 10 Day Peru Itinerary for First-Timers",by:"Travel Lemming"},
   cities:[{name:"Lima",lng:-77.04,lat:-12.06,capital:true},{name:"Arequipa",lng:-71.54,lat:-16.40},{name:"Trujillo",lng:-79.03,lat:-8.11},{name:"Chiclayo",lng:-79.84,lat:-6.77},{name:"Cusco",lng:-71.98,lat:-13.52},{name:"Piura",lng:-80.63,lat:-5.20},{name:"Iquitos",lng:-73.25,lat:-3.75}],
   maps:"https://www.google.com/maps/place/Peru/@-9.2,-75,5z",
   facts:{capital:"Lima",population:"≈ 34.0 million (2024)",languages:"Spanish, Quechua & Aymara (all official)",langCount:"≈ 90+ languages spoken in total",independence:"July 28, 1821 — from Spain",government:"Unitary presidential republic",etymology:"Possibly from <em>Birú</em>, a local ruler near the Bay of San Miguel."},
   people:[{n:"Pachacuti",r:"Inca emperor — architect of the empire",img:"Brooklyn Museum - Pachacuti, Tenth Inca, 1 of 14 Portraits of Inca Kings (cropped).jpg"},{n:"Atahualpa",r:"last sovereign Inca emperor",img:"Atahuallpa, Inca XIIII From Berlin Ethnologisches Museum, Staatliche Museen, Berlin, Germany.png"},{n:"José de San Martín",r:"liberator who proclaimed independence",img:"José de San Martín (retrato, c.1828).jpg"},{n:"Túpac Amaru II",r:"led the great Andean uprising",img:"TupacAmaruII.jpg"},{n:"César Vallejo",r:"revolutionary poet of the 20th century",img:"Cesar_vallejo_1929.jpg"}],
   art:{n:"Fernando de Szyszlo",r:"Peru's foremost abstract painter",img:"Fernando_de_Szyszlo_2009.jpg"}, writer:{n:"Mario Vargas Llosa",r:"Nobel novelist of Latin America",img:"Mario_Vargas_Llosa_LCCN2020733847_(cropped).png"}, stage:{n:"Magaly Solier",r:"Cannes-honored indigenous film actress",img:"Presidente_del_Congreso_recibió_a_Magaly_Solier_(cropped).jpg"}, music:{n:"Yma Sumac",r:"four-octave soprano — global \"Inca Princess\"",img:"Yma Sumac in Italy.jpg"},
   sports:{n:"Teófilo Cubillas",r:"legendary striker — Peru's greatest footballer",img:"Teófilo Cubillas 1978.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Peru"},{label:"Facts & figures",detail:"Wikipedia — \"Peru\" & related articles",url:"https://en.wikipedia.org/wiki/Peru"},{label:"Travel film",detail:"YouTube — \"The Perfect 10 Day Peru Itinerary\" · Travel Lemming",url:"https://www.youtube.com/watch?v=AHBz5CkQAr8"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Peru/@-9.2,-75,5z"}] },
  IE: { tagline:"The Emerald Isle · wild Atlantic edges & ancient stone",
   photos:[{f:"Cliffs-Of-Moher-OBriens-From-South.JPG",cap:"Cliffs of Moher · County Clare"},{f:"HalfPennyBridge.jpg",cap:"Ha'penny Bridge · Dublin"},{f:"Atlantic_Ocean,_Ring_of_Kerry_(506559)_(27964189752).jpg",cap:"Ring of Kerry · Atlantic coast"},{f:"Ladies_view.jpg",cap:"Ladies View · Killarney National Park"},{f:"The Dingle Peninsula, County Kerry, Ireland as seen from the south 01.jpg",cap:"Dingle Peninsula · County Kerry"},{f:"Connemara Landscape (42075670542).jpg",cap:"Connemara · County Galway"},{f:"Rock_of_Cashel_(49163525453).jpg",cap:"Rock of Cashel · County Tipperary"},{f:"Galway_cathedral.jpg",cap:"Galway Cathedral · the City of Tribes"},{f:"Irelands_history.jpg",cap:"Newgrange · 5,000-year-old passage tomb"},{f:"Islands off the end of the Dingle peninsula.jpg",cap:"Atlantic islands · off the Dingle coast"}],
   video:{id:"qMvFBRKTWfs",title:"10-Day Ireland Road Trip: The Ultimate Travel Guide",by:"Globe Trekker"},
   cities:[{name:"Dublin",lng:-6.26,lat:53.35,capital:true},{name:"Cork",lng:-8.47,lat:51.90},{name:"Limerick",lng:-8.62,lat:52.66},{name:"Galway",lng:-9.05,lat:53.27},{name:"Waterford",lng:-7.11,lat:52.26},{name:"Kilkenny",lng:-7.25,lat:52.65},{name:"Killarney",lng:-9.52,lat:52.06}],
   maps:"https://www.google.com/maps/place/Ireland/@53.4,-8,7z",
   facts:{capital:"Dublin",population:"≈ 5.3 million (2024)",languages:"Irish & English (both official)",langCount:"≈ 5 languages spoken in total",independence:"Dec 6, 1922 — Irish Free State from the UK; republic 1949",government:"Unitary parliamentary republic",etymology:"From <em>Éire</em>, the Irish goddess and name, plus <em>land</em>."},
   people:[{n:"Daniel O'Connell",r:"\"The Liberator\" — won Catholic emancipation",img:"Daniel_O'Connell.png"},{n:"Charles Stewart Parnell",r:"champion of Irish Home Rule",img:"Charles_Stewart_Parnell_-_Brady-Handy.jpg"},{n:"Michael Collins",r:"revolutionary leader & founding statesman",img:"Michael_Collins.jpg"},{n:"Éamon de Valera",r:"independence leader, president & taoiseach",img:"De_Valera_LCCN2016822004_(headshot).jpg"},{n:"W. B. Yeats",r:"poet — Nobel laureate of the Irish revival",img:"William_Butler_Yeats_by_George_Charles_Beresford.jpg"}],
   art:{n:"Francis Bacon",r:"Visceral figurative painter",img:"Somer_Francis_Bacon.jpg"}, writer:{n:"James Joyce",r:"Modernist author of Ulysses",img:"Revolutionary_Joyce_Better_Contrast.jpg"}, stage:{n:"Saoirse Ronan",r:"Acclaimed film actress",img:"MKr349648_Saoirse_Ronan_(The_Outrun,_Berlinale_2024).jpg"}, music:{n:"U2",r:"the globe-conquering Dublin rock band",img:"U2_on_Joshua_Tree_Tour_2017_Brussels_8-1-17.jpg"},
   sports:{n:"Roy Keane",r:"iconic Manchester United & Ireland captain",img:"Roy_keane_2014.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ireland"},{label:"Facts & figures",detail:"Wikipedia — \"Ireland\" & related articles",url:"https://en.wikipedia.org/wiki/Ireland"},{label:"Travel film",detail:"YouTube — \"10-Day Ireland Road Trip\" · Globe Trekker",url:"https://www.youtube.com/watch?v=qMvFBRKTWfs"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ireland/@53.4,-8,7z"}] },
  PL: { tagline:"Serce Europy · a thousand years of grit and grace",
   photos:[{f:"Krakow_Rynek_Glowny_panorama_2.jpg",cap:"Main Market Square · Kraków"},{f:"Krakow_-_Wawel_Cathedral_from_balloon_-_2.jpg",cap:"Wawel Castle · Kraków"},{f:"Warszawa_Stare_Miasto_(dron).jpg",cap:"Old Town · Warsaw"},{f:"Wieliczka-color.jpg",cap:"Wieliczka Salt Mine · carved in salt"},{f:"Zespół_Zamku_Krzyżackiego_MALBORK_01.jpg",cap:"Malbork Castle · the largest brick fortress"},{f:"Tatra_mountains_western_side_2.jpg",cap:"Tatra Mountains · the Polish highlands"},{f:"Zakopane_T58.jpg",cap:"Zakopane · gateway to the peaks"},{f:"Calle_Dlugie_Pobrzeze,_Gdansk,_Polonia,_2013-05-20,_DD_06.jpg",cap:"Long Embankment · Gdańsk"},{f:"Wroclaw-_Most_Grunwaldzki.jpg",cap:"Grunwald Bridge · Wrocław"},{f:"Jezioro_Dadaj_by_RecDronepl.jpg",cap:"Masurian Lakes · Poland's water country"}],
   video:{id:"p1VXDm8Kmdg",title:"9 Days in Poland on a Budget",by:"Morris to See"},
   cities:[{name:"Warsaw",lng:21.01,lat:52.23,capital:true},{name:"Kraków",lng:19.94,lat:50.06},{name:"Łódź",lng:19.46,lat:51.77},{name:"Wrocław",lng:17.04,lat:51.11},{name:"Poznań",lng:16.93,lat:52.41},{name:"Gdańsk",lng:18.65,lat:54.35},{name:"Szczecin",lng:14.55,lat:53.43},{name:"Lublin",lng:22.57,lat:51.25}],
   maps:"https://www.google.com/maps/place/Poland/@52.0,19.0,6z",
   facts:{capital:"Warsaw",population:"≈ 37.0 million (2024)",languages:"Polish (official)",langCount:"≈ 15 languages spoken in total",independence:"Nov 11, 1918 — restored after 123 years of partitions; state founded 966",government:"Unitary parliamentary republic",etymology:"From the <em>Polans</em> tribe — from <em>pole</em>, \"field\" or \"plain.\""},
   people:[{n:"Nicolaus Copernicus",r:"astronomer — placed the Sun at the center",img:"Nikolaus_Kopernikus_MOT.jpg"},{n:"John III Sobieski",r:"king — victor at the 1683 Siege of Vienna",img:"Schultz_John_III_Sobieski.jpg"},{n:"Tadeusz Kościuszko",r:"national hero of Poland and America",img:"Karl_G_Schweikart_-_Tadeusz_Kościuszko_(ÖaL).jpg"},{n:"Józef Piłsudski",r:"statesman — father of restored Poland",img:"Józef_Piłsudski_(-1930).jpg"},{n:"Pope John Paul II",r:"the first Polish pope",img:"ADAMELLO_-_PAPA_-_Giovanni_Paolo_II_-_panoramio_(cropped).jpg"}],
   art:{n:"Tamara de Lempicka",r:"Art Deco portrait painter",img:"Tamara Łempicka ssj 20060914 - cropped.jpg"}, writer:{n:"Adam Mickiewicz",r:"National Romantic poet",img:"Adam_Mickiewicz_według_dagerotypu_paryskiego_z_1842_roku.jpg"}, stage:{n:"Helena Modjeska",r:"Legendary Shakespearean stage actress",img:"Helena_Modjeska_ca._1890_by_Sarony_(Gardner_Mus_ARC006444)_-_crop.jpg"}, music:{n:"Frédéric Chopin",r:"the poet of the piano",img:"Frederic_Chopin_photo.jpeg"},
   sports:{n:"Robert Lewandowski",r:"one of the world's greatest strikers",img:"2019147183134_2019-05-27_Fussball_1.FC_Kaiserslautern_vs_FC_Bayern_München_-_Sven_-_1D_X_MK_II_-_0228_-_B70I8527_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Poland"},{label:"Facts & figures",detail:"Wikipedia — \"Poland\" & related articles",url:"https://en.wikipedia.org/wiki/Poland"},{label:"Travel film",detail:"YouTube — \"9 Days in Poland on a Budget\" · Morris to See",url:"https://www.youtube.com/watch?v=p1VXDm8Kmdg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Poland/@52.0,19.0,6z"}] },
  VN: { tagline:"Đất nước hình chữ S — dragons, deltas, and lantern light",
   photos:[{f:"Ha_Long_Bay_in_2019.jpg",cap:"Hạ Long Bay · limestone karsts"},{f:"Hanoi_skyline_with_Ba_Vi_Mountain.jpg",cap:"Hanoi · skyline & Ba Vì Mountain"},{f:"Hoi_An_by_night_(16918).jpg",cap:"Hội An · lantern-lit old town"},{f:"Ho_Chi_Minh_City_panorama_2019_(cropped2).jpg",cap:"Ho Chi Minh City · river skyline"},{f:"Terraced_fields_Sa_Pa_Vietnam.JPG",cap:"Sa Pa · terraced rice fields"},{f:"Thành_phố_Huế_nhìn_từ_trên_cao_(2).jpg",cap:"Huế · imperial capital from above"},{f:"Phongnhakebang6.jpg",cap:"Phong Nha–Kẻ Bàng · cave country"},{f:"Muaxuantamcoc.jpg",cap:"Tràng An · Ninh Bình's karst waterways"},{f:"Cai_Rang_Floating_Market_3.jpg",cap:"Cái Răng · Mekong floating market"},{f:"RiceTerracesVietnam.jpg",cap:"Highland rice terraces at harvest"}],
   video:{id:"th_eS7Xub-s",title:"Our Vietnam Travel Guide 2024 | Hanoi, Hoi An & Ho Chi Minh",by:"Retirement Travelers"},
   cities:[{name:"Hanoi",lng:105.83,lat:21.03,capital:true},{name:"Ho Chi Minh City",lng:106.66,lat:10.82},{name:"Da Nang",lng:108.22,lat:16.05},{name:"Hải Phòng",lng:106.68,lat:20.86},{name:"Cần Thơ",lng:105.78,lat:10.04},{name:"Huế",lng:107.60,lat:16.46},{name:"Nha Trang",lng:109.19,lat:12.24}],
   maps:"https://www.google.com/maps/place/Vietnam/@16,106,6z",
   facts:{capital:"Hanoi",population:"≈ 100.3 million (2024)",languages:"Vietnamese (official)",langCount:"≈ 100+ languages spoken in total",independence:"September 2, 1945 — from France & Japan; reunified 1976",government:"Unitary Marxist–Leninist one-party socialist republic",etymology:"From <em>Việt Nam</em> — the <em>Việt</em> people of the South."},
   people:[{n:"Hồ Chí Minh",r:"founding father & first president",img:"Ho_Chi_Minh_-_1946_Portrait_(cropped).jpg"},{n:"Hai Bà Trưng",r:"the Trưng Sisters — 1st-century rebel queens",img:"Hai_Bà_Trưng_(tranh_Đông_Hồ).jpeg"},{n:"Lý Thái Tổ",r:"emperor who founded Hanoi in 1010",img:"Tượng_Lý_Thái_Tổ_2.jpg"},{n:"Trần Hưng Đạo",r:"general who repelled the Mongol invasions",img:"Tran_Hung_Dao_statue.jpg"},{n:"Võ Nguyên Giáp",r:"general — architect of Điện Biên Phủ",img:"Vo_Nguyen_Giap2.jpg"}],
   art:{n:"Lê Phổ",r:"Master of silk painting",img:""}, writer:{n:"Nguyễn Du",r:"Poet of The Tale of Kiều",img:"Tượng_đài_cụ_Nguyễn_Du.jpg"}, stage:{n:"Ke Huy Quan",r:"Oscar-winning Hollywood actor",img:"Ke_Huy_Quan_at_the_White_House_(52902390767)_(cropped).jpg"}, music:{n:"Đặng Thái Sơn",r:"first Asian to win the Chopin Piano Competition",img:"Đặng_Thái_Sơn_Hà_Nội_2021.jpg"},
   sports:{n:"Nguyễn Quang Hải",r:"star midfielder of the national football team",img:"Nguyễn_Quang_Hải.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Vietnam"},{label:"Facts & figures",detail:"Wikipedia — \"Vietnam\" & related articles",url:"https://en.wikipedia.org/wiki/Vietnam"},{label:"Travel film",detail:"YouTube — \"Our Vietnam Travel Guide 2024\" · Retirement Travelers",url:"https://www.youtube.com/watch?v=th_eS7Xub-s"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Vietnam/@16,106,6z"}] },
  IR: { tagline:"Persia · 2,500 years of empire, poetry & tilework",
   photos:[{f:"Persépolis, Irán, 2016-09-24, DD 53.jpg",cap:"Persepolis · ceremonial capital of the Achaemenids"},{f:"Naqsh-i Jahan Square, Jan. 2018.jpg",cap:"Naqsh-e Jahan Square · Isfahan"},{f:"Sheikh Lotfallah Esfahan.JPG",cap:"Sheikh Lotfollah Mosque · Isfahan"},{f:"Nasir-al molk -1.jpg",cap:"Nasir al-Mulk Mosque · Shiraz"},{f:"Azadi Tower (29358497718).jpg",cap:"Azadi Tower · Tehran"},{f:"Milad tower2023.jpg",cap:"Milad Tower · Tehran skyline"},{f:"Iran 1343 Yazd (8665215641).jpg",cap:"Yazd · the old desert city"},{f:"Palais du Golestan, Téhéran (5).jpg",cap:"Golestan Palace · Tehran"},{f:"Pasargad Tomb Cyrus3.jpg",cap:"Pasargadae · tomb of Cyrus the Great"},{f:"Dasht-e Kavir.jpg",cap:"Dasht-e Kavir · the Great Salt Desert"}],
   video:{id:"9-ziQwRPI_g",title:"Iran Travel Itinerary for 10 Days | 4K Vlog",by:"Alp Galip Travels"},
   cities:[{name:"Tehran",lng:51.39,lat:35.69,capital:true},{name:"Mashhad",lng:59.54,lat:36.33},{name:"Isfahan",lng:51.67,lat:32.67},{name:"Shiraz",lng:52.54,lat:29.61},{name:"Tabriz",lng:46.30,lat:38.07},{name:"Karaj",lng:50.97,lat:35.83},{name:"Yazd",lng:54.34,lat:31.88},{name:"Qom",lng:50.88,lat:34.64}],
   maps:"https://www.google.com/maps/place/Iran/@32,53,5z",
   facts:{capital:"Tehran",population:"≈ 89 million (2024)",languages:"Persian (Farsi, official); Azerbaijani, Kurdish & others",langCount:"≈ 75+ languages spoken in total",independence:"continuous statehood since 550 BC (Achaemenid Empire); Islamic Republic since 1979",government:"Unitary Islamic republic",etymology:"From <em>Iran</em> — \"land of the <em>Aryans</em>\"; known abroad as <em>Persia</em> until 1935."},
   people:[{n:"Cyrus the Great",r:"founder of the Achaemenid Empire, 6th c. BC",img:"Cyrus II (The Great) (cropped).jpg"},{n:"Darius the Great",r:"king who built Persepolis & the royal road",img:"Darius I.jpg"},{n:"Ferdowsi",r:"poet of the Shahnameh, Iran's national epic",img:"Imaginary depiction of the poet Firdausi. Folio from a Khavarannama (The Book of the East) of ibn Husam al-Din, 1476-1486 (cropped).jpg"},{n:"Avicenna (Ibn Sina)",r:"physician-philosopher, father of early medicine",img:"Avicenna Bust, left profile (cropped).jpg"},{n:"Omar Khayyam",r:"poet, mathematician & astronomer",img:"Hakim Omar Khayam - panoramio.jpg"}],
   art:{n:"Shirin Neshat",r:"Photographer of veiled identity",img:"Viennale_talk_(2),_Shirin_Neshat.jpg"}, writer:{n:"Rumi",r:"Beloved mystical Persian poet",img:"مولانا_اثر_حسین_بهزاد_(cropped).jpg"}, stage:{n:"Golshifteh Farahani",r:"Exiled international film star",img:"Golshifteh_Farahani_at_the_2024_Toronto_International_Film_Festival_5_(cropped).jpg"}, music:{n:"Mohammad-Reza Shajarian",r:"the revered maestro of Persian classical song",img:"Mohammad-Reza Shajarian press conference - 26 December 2007 (8 8610050604 L600).jpg"},
   sports:{n:"Gholamreza Takhti",r:"Olympic wrestling champion & national hero",img:"Portrait of Gholamreza Takhti.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Iran"},{label:"Facts & figures",detail:"Wikipedia — \"Iran\" & related articles",url:"https://en.wikipedia.org/wiki/Iran"},{label:"Travel film",detail:"YouTube — \"Iran Travel Itinerary for 10 Days\" · Alp Galip Travels",url:"https://www.youtube.com/watch?v=9-ziQwRPI_g"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Iran/@32,53,5z"}] },
  IL: { tagline:"Land of milk and honey · where three faiths meet the Mediterranean",
   photos:[{f:"2014-06_East_Jerusalem_090_(14936890061).jpg",cap:"Old City skyline · Jerusalem"},{f:"Westernwall2.jpg",cap:"The Western Wall · Jerusalem"},{f:"Jerusalem-2013(2)-Temple_Mount-Dome_of_the_Rock_(SE_exposure).jpg",cap:"Dome of the Rock · Temple Mount"},{f:"Sarona_CBD_01_(cropped).jpg",cap:"Skyline · Tel Aviv"},{f:"Tel_Aviv_Promenade_panoramics.jpg",cap:"Beachfront promenade · Tel Aviv"},{f:"Dead_Sea_beach_00.JPG",cap:"The Dead Sea · lowest point on Earth"},{f:"Israel-2013-Aerial_21-Masada.jpg",cap:"Masada fortress · Judaean Desert"},{f:"The_Bahai_Temple_in_Haifa_Israel.jpg",cap:"Bahá'í Gardens · Haifa"},{f:"Kinneret_cropped.jpg",cap:"Sea of Galilee · the Kinneret"},{f:"MakhteshRamonMar262022_01.jpg",cap:"Ramon Crater · the Negev"}],
   video:{id:"EN476JfUr2s",title:"Israel Travel Guide: 10 Must See Destinations",by:"RMV Travel"},
   cities:[{name:"Jerusalem",lng:35.22,lat:31.78,capital:true},{name:"Tel Aviv",lng:34.78,lat:32.08},{name:"Haifa",lng:34.99,lat:32.79},{name:"Rishon LeZion",lng:34.79,lat:31.96},{name:"Petah Tikva",lng:34.89,lat:32.09},{name:"Ashdod",lng:34.65,lat:31.80},{name:"Beersheba",lng:34.79,lat:31.25},{name:"Netanya",lng:34.86,lat:32.33}],
   maps:"https://www.google.com/maps/place/Israel/@31.4,35,7z",
   facts:{capital:"Jerusalem (declared); Tel Aviv is the economic hub",population:"≈ 9.9 million (2024)",languages:"Hebrew (official); Arabic (special status); English widely used",langCount:"≈ 35 languages spoken in total",independence:"May 14, 1948 — from British Mandate rule",government:"Unitary parliamentary republic",etymology:"From <em>Yisrael</em> — a biblical name meaning \"one who <em>struggles with God</em>.\""},
   people:[{n:"Theodor Herzl",r:"visionary father of modern political Zionism",img:"Theodor_Herzl_(3x4_cropped).jpg"},{n:"David Ben-Gurion",r:"founding father & first prime minister",img:"David_Ben-Gurion_(D597-087).jpg"},{n:"Chaim Weizmann",r:"chemist & first president of Israel",img:"Flickr_-_Government_Press_Office_(GPO)_-_President_Chaim_Weizmann_(retouched).jpg"},{n:"Golda Meir",r:"fourth prime minister of Israel",img:"Golda_Meir_03265u-2_(cropped).jpg"},{n:"Yitzhak Rabin",r:"prime minister & Nobel Peace laureate",img:"Yitzhak_Rabin_1994_Portrait_(3x4_cropped).jpg"}],
   art:{n:"Yaacov Agam",r:"Pioneer of kinetic op-art",img:"Yaacov_Agam_(cropped).JPG"}, writer:{n:"Amos Oz",r:"Renowned novelist and essayist",img:"Amos_Oz,_Israeli_author_(cropped).jpg"}, stage:{n:"Gal Gadot",r:"Wonder Woman screen star",img:"Gal_Gadot_by_Gage_Skidmore_3.jpg"}, music:{n:"Ofra Haza",r:"the \"Madonna of the East\" — global Yemenite-Israeli star",img:"Ofra_Haza_1981_(עפרה_חזה_1981).jpg"},
   sports:{n:"Artem Dolgopyat",r:"2× Olympic gold gymnast (2020, 2024)",img:"Artem_Dolgopyat_Honored_at_Beit_HaNassi,_in_Jerusalem_(5136)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Israel"},{label:"Facts & figures",detail:"Wikipedia — \"Israel\" & related articles",url:"https://en.wikipedia.org/wiki/Israel"},{label:"Travel film",detail:"YouTube — \"Israel Travel Guide: 10 Must See Destinations\" · RMV Travel",url:"https://www.youtube.com/watch?v=EN476JfUr2s"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Israel/@31.4,35,7z"}] },
  MA: { tagline:"Al-Maghrib · where the Atlas meets the Sahara and the sea",
   photos:[{f:"Djemaa_el_Fna.jpg",cap:"Jemaa el-Fnaa · Marrakech"},{f:"Chefchaouen_(52189357475).jpg",cap:"The blue city · Chefchaouen"},{f:"Fes_Bab_Bou_Jeloud_2011.jpg",cap:"Bab Bou Jeloud gate · Fes medina"},{f:"Fez_Chouara_Tannery_(54238811661).jpg",cap:"Chouara tannery · Fes"},{f:"Merzouga_Dunes_2011.jpg",cap:"Erg Chebbi dunes · Merzouga"},{f:"The_Open_Area_of_Hassan_II_Mosque_-_Casablanca_Morocco.jpg",cap:"Hassan II Mosque · Casablanca"},{f:"AïtBenhaddou_Morocco_2.jpg",cap:"Ksar of Aït Benhaddou"},{f:"Kasbah_Oudayas_exterior.jpg",cap:"Kasbah of the Udayas · Rabat"},{f:"Plateau_Yagour,_Agdal,_Morocco.jpg",cap:"High Atlas Mountains"},{f:"Morocco_-_Essaouira_Part_2_(31679848385).jpg",cap:"Atlantic ramparts · Essaouira"}],
   video:{id:"JUx2hF1spqo",title:"16 Days in Morocco | Steal My Travel Itinerary",by:"Anela Malik"},
   cities:[{name:"Rabat",lng:-6.83,lat:34.02,capital:true},{name:"Casablanca",lng:-7.59,lat:33.57},{name:"Marrakech",lng:-7.99,lat:31.63},{name:"Fes",lng:-5.00,lat:34.04},{name:"Tangier",lng:-5.80,lat:35.77},{name:"Agadir",lng:-9.60,lat:30.42},{name:"Meknes",lng:-5.55,lat:33.90},{name:"Chefchaouen",lng:-5.27,lat:35.17}],
   maps:"https://www.google.com/maps/place/Morocco/@31.8,-7,6z",
   facts:{capital:"Rabat",population:"≈ 38.1 million (2024)",languages:"Arabic & Berber/Tamazight (official); French widely used",langCount:"≈ 12 languages spoken in total",independence:"March 2, 1956 — from France (and Spain)",government:"Unitary parliamentary constitutional monarchy",etymology:"English <em>Morocco</em> comes from <em>Marrakesh</em>, a former capital; the Arabic name <em>al-Maghrib</em> means \"the West.\""},
   people:[{n:"Ibn Battuta",r:"14th-century explorer — history's great traveler",img:"Handmade_oil_painting_reproduction_of_Ibn_Battuta_in_Egypt,_a_painting_by_Hippolyte_Leon_Benett..jpg"},{n:"Yusuf ibn Tashfin",r:"Almoravid ruler — founder of Marrakesh",img:"Yusuf_Ben_Tasfin_dinar_22562.jpg"},{n:"Ahmad al-Mansur",r:"Saadian sultan — golden-age empire-builder",img:"Ahmad_al-Mansur_by_André_Thevet.png"},{n:"Mohammed V",r:"sultan & king — father of independence",img:"Mohammed_V_(1953).jpg"},{n:"Hassan II",r:"king who shaped modern Morocco (1961–99)",img:"Hassan_II_of_Morocco_official_portrait.jpg"}],
   art:{n:"Hassan El Glaoui",r:"Painter of Moroccan horsemen",img:""}, writer:{n:"Tahar Ben Jelloun",r:"Prix Goncourt-winning novelist",img:"Tahar_Ben_Jelloun_par_Claude_Truong-Ngoc_sept_2013.jpg"}, stage:{n:"Gad Elmaleh",r:"Comedian and film actor",img:"Gad_Elmaleh_Cannes_2019.jpg"}, music:{n:"RedOne",r:"superstar producer behind global pop hits",img:"RedOne_2017_press_image.jpg"},
   sports:{n:"Hicham El Guerrouj",r:"the \"King of the Mile\" — 2× Olympic gold",img:"Hicham_El_Guerrouj_cropped.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Morocco"},{label:"Facts & figures",detail:"Wikipedia — \"Morocco\" & related articles",url:"https://en.wikipedia.org/wiki/Morocco"},{label:"Travel film",detail:"YouTube — \"16 Days in Morocco\" · Anela Malik",url:"https://www.youtube.com/watch?v=JUx2hF1spqo"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Morocco/@31.8,-7,6z"}] },
  ET: { tagline:"The roof of Africa · ancient, uncolonized, unforgettable",
   photos:[{f:"Lalibela,_san_giorgio,_esterno_24.jpg",cap:"Church of St. George · Lalibela"},{f:"Bwahit,_view_onto_Kidis_Yared_4453m.JPG",cap:"Simien Mountains · Bwahit peak"},{f:"Ethiopia_-_dry_landscape_in_the_Danakil_Depression.jpg",cap:"Danakil Depression · the Afar desert"},{f:"ET_Gondar_asv2018-02_img18_Fasil_Ghebbi.jpg",cap:"Fasil Ghebbi · Gondar's royal castles"},{f:"Blue_Nile_Falls-03,_by_CT_Snow.jpg",cap:"Blue Nile Falls · Tis Issat"},{f:"Addis_in_night.jpg",cap:"Addis Ababa · after dark"},{f:"ET_Amhara_asv2018-02_img097_Lake_Tana_at_Bahir_Dar.jpg",cap:"Lake Tana · source of the Blue Nile"},{f:"Dassanech_Tribe,_Omo_Valley,_Ethiopia_(6840885950).jpg",cap:"Dassanech people · Omo Valley"},{f:"Harenna_Forest_(16139095228).jpg",cap:"Harenna Forest · Bale Mountains"},{f:"Erta_Ale.jpg",cap:"Erta Ale · a lava-lake volcano"}],
   video:{id:"2xW9mTStyhM",title:"Journey Through Ethiopia - Africa Travel Documentary",by:"Stef Hoffer"},
   cities:[{name:"Addis Ababa",lng:38.74,lat:9.03,capital:true},{name:"Dire Dawa",lng:41.87,lat:9.59},{name:"Mekelle",lng:39.48,lat:13.50},{name:"Gondar",lng:37.47,lat:12.61},{name:"Bahir Dar",lng:37.39,lat:11.59},{name:"Hawassa",lng:38.48,lat:7.06},{name:"Adama",lng:39.27,lat:8.54}],
   maps:"https://www.google.com/maps/place/Ethiopia/@9,40,6z",
   facts:{capital:"Addis Ababa",population:"≈ 128 million (2024)",languages:"Amharic (federal working language); Oromo, Somali, Tigrinya + 80 more",langCount:"≈ 90+ languages spoken in total",independence:"Ancient statehood; never colonized — briefly occupied by Italy 1936–41",government:"Federal parliamentary republic",etymology:"From Greek <em>Aithiopia</em> — \"land of <em>burnt faces</em>.\""},
   people:[{n:"Haile Selassie",r:"last emperor — revered as messiah by Rastafari",img:"Haile_Selassie_in_full_dress_(3x4_cropped).jpg"},{n:"Menelik II",r:"crushed Italy at Adwa in 1896",img:"Emperor_Menelik_II.png"},{n:"Tewodros II",r:"emperor who began Ethiopia's modern unification",img:"Téwodros_II_-_2.jpg"},{n:"Empress Taytu Betul",r:"co-ruler & founder of Addis Ababa",img:"Taytu_Betul.jpg"},{n:"Ezana of Axum",r:"4th-century king who made Christianity official",img:"AXUM._Ezanas._Circa_330-360.jpg"}],
   art:{n:"Julie Mehretu",r:"Large-scale abstract painter",img:"Inside_the_Studio_with_Julie_Mehretu_00.01_(cropped).jpg"}, writer:{n:"Maaza Mengiste",r:"Booker-shortlisted novelist",img:"Maaza_Mengiste_at_BookExpo_(05586)_(cropped).jpg"}, stage:{n:"Ruth Negga",r:"Oscar-nominated screen actress",img:"Ruth_Negga_at_the_2026_Cannes_Film_Festival_by_YantsImages_01_(cropped).jpg"}, music:{n:"Mulatu Astatke",r:"the father of Ethio-jazz",img:"Mulatu_Astatke_Cosmopolite_2017_(221840).jpg"},
   sports:{n:"Abebe Bikila",r:"won the 1960 Olympic marathon barefoot",img:"Abebe_Bikila_1968_(b_retouched).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ethiopia"},{label:"Facts & figures",detail:"Wikipedia — \"Ethiopia\" & related articles",url:"https://en.wikipedia.org/wiki/Ethiopia"},{label:"Travel film",detail:"YouTube — \"Journey Through Ethiopia\" · Stef Hoffer",url:"https://www.youtube.com/watch?v=2xW9mTStyhM"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ethiopia/@9,40,6z"}] },
  KE: { tagline:"Where the savanna runs wild — cradle of the safari",
   photos:[{f:"Masai_Mara_at_Sunset.jpg",cap:"Maasai Mara · golden-hour savanna"},{f:"Lion at Maasai Mara National Reserve Kenya.jpg",cap:"Big cats of the Mara"},{f:"Wildebeest herd on hillside, Maasai Mara, Kenya.jpg",cap:"The Great Migration · Maasai Mara"},{f:"MtKenya.jpg",cap:"Mount Kenya · the nation's namesake peak"},{f:"Amboseli National Park and Mt. Kilimanjaro.jpg",cap:"Amboseli · elephants beneath Kilimanjaro"},{f:"Nairobi_skyline_from_Gem_Hotel.jpg",cap:"Nairobi · the green city skyline"},{f:"Lake Nakuru National Park 02 - Lesser Flamingo (Phoeniconaias minor).jpg",cap:"Lake Nakuru · rivers of flamingos"},{f:"Diani_Beach_Ukunda.jpg",cap:"Diani Beach · Indian Ocean white sand"},{f:"Hell's_Gate,_Kenya.jpg",cap:"Hell's Gate · Rift Valley gorges"},{f:"Lamu_Old_Town.jpg",cap:"Lamu · Swahili stone-town lanes"}],
   video:{id:"xTYnb78h4G4",title:"This Kenya Safari Will Blow Your Mind (Masai Mara)",by:"Ella McKendrick"},
   cities:[{name:"Nairobi",lng:36.82,lat:-1.29,capital:true},{name:"Mombasa",lng:39.67,lat:-4.05},{name:"Kisumu",lng:34.77,lat:-0.08},{name:"Nakuru",lng:36.07,lat:-0.30},{name:"Eldoret",lng:35.28,lat:0.52},{name:"Thika",lng:37.08,lat:-1.05},{name:"Malindi",lng:40.13,lat:-3.22}],
   maps:"https://www.google.com/maps/place/Kenya/@0.2,37.9,6z",
   facts:{capital:"Nairobi",population:"≈ 56 million (2024)",languages:"Swahili & English (official)",langCount:"≈ 68 languages spoken in total",independence:"December 12, 1963 — from the United Kingdom",government:"Unitary presidential republic",etymology:"From <em>Mount Kenya</em> — the Kikuyu/Kamba name <em>Kĩrĩnyaga</em>, \"God's resting place.\""},
   people:[{n:"Jomo Kenyatta",r:"founding father — first president of Kenya",img:"Jomo_Kenyatta_(cropped)_in_June_15th,_1966.jpg"},{n:"Wangari Maathai",r:"Nobel Peace laureate — Green Belt founder",img:"Wangari_Maathai_in_2001.jpg"},{n:"Dedan Kimathi",r:"Mau Mau leader in the independence uprising",img:"Dedan_Kimathi_Waciuri_-_Veteran_Mau_Mau_Leader_in_Kenya.jpg"},{n:"Tom Mboya",r:"pan-Africanist statesman & independence architect",img:"Tom_Mboya_1962_(cropped).jpg"},{n:"Daniel arap Moi",r:"longtime president — ruled 1978 to 2002",img:"Daniel_arap_Moi_1979b.jpg"}],
   art:{n:"Wangechi Mutu",r:"Afrofuturist collage and sculpture",img:""}, writer:{n:"Ngũgĩ wa Thiong'o",r:"Novelist decolonizing African literature",img:"Ngugi_wa_Thiong'o_-_Festivaletteratura_2012.JPG"}, stage:{n:"Lupita Nyong'o",r:"Oscar-winning screen actress",img:"Lupita_Nyong'o_by_Gage_Skidmore_4.jpg"}, music:{n:"Sauti Sol",r:"Afro-pop band — Kenya's biggest global act",img:"Sauti-Sol.jpg"},
   sports:{n:"Eliud Kipchoge",r:"marathon GOAT — first to run under 2 hours",img:"Eliud_Kipchoge_in_Berlin_-_2015_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Kenya"},{label:"Facts & figures",detail:"Wikipedia — \"Kenya\" & related articles",url:"https://en.wikipedia.org/wiki/Kenya"},{label:"Travel film",detail:"YouTube — \"This Kenya Safari Will Blow Your Mind\" · Ella McKendrick",url:"https://www.youtube.com/watch?v=xTYnb78h4G4"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Kenya/@0.2,37.9,6z"}] },
  UA: { tagline:"Kraina — where golden domes meet Carpathian peaks",
   photos:[{f:"80-391-0151_Kyiv_St.Sophia's_Cathedral_RB_18_2_(cropped).jpg",cap:"St. Sophia's Cathedral · Kyiv"},{f:"Golden_Gate_Kiev_2018_G1.jpg",cap:"The Golden Gate · Kyiv"},{f:"Лавра.jpg",cap:"Kyiv Pechersk Lavra · the Monastery of the Caves"},{f:"Латинський_кафедральний_собор_(Львів)_16.jpg",cap:"Old Town rooftops · Lviv"},{f:"Потьомкінські_сходи_11.jpg",cap:"The Potemkin Stairs · Odesa"},{f:"Зимова_фортеця.jpg",cap:"Kamianets-Podilskyi Castle in winter"},{f:"73-250-0001_Khotyn_Fortress_RB_18.jpg",cap:"Khotyn Fortress on the Dniester"},{f:"Резиденція_митрополитів_Буковини_і_Далмації_5.jpg",cap:"Chernivtsi University · a UNESCO residence"},{f:"Tunnel of Love (15899873014).jpg",cap:"The Tunnel of Love · Klevan"},{f:"Ранкові_промені_на_Синевирі.jpg",cap:"Dawn over Lake Synevyr · the Carpathians"}],
   video:{id:"lAyWhJ6tr9E",title:"Top 10 Places To Visit In Ukraine - 4K Travel Guide",by:"Ryan Shirley"},
   cities:[{name:"Kyiv",lng:30.52,lat:50.45,capital:true},{name:"Kharkiv",lng:36.23,lat:49.99},{name:"Odesa",lng:30.73,lat:46.48},{name:"Dnipro",lng:35.05,lat:48.46},{name:"Lviv",lng:24.03,lat:49.84},{name:"Zaporizhzhia",lng:35.14,lat:47.84},{name:"Vinnytsia",lng:28.47,lat:49.23}],
   maps:"https://www.google.com/maps/place/Ukraine/@48.4,31,6z",
   facts:{capital:"Kyiv",population:"≈ 38 million (2024, est.)",languages:"Ukrainian (official); Russian & minority languages widely spoken",langCount:"≈ 40+ languages spoken in total",independence:"Aug 24, 1991 — from the Soviet Union",government:"Unitary semi-presidential republic",etymology:"From the Slavic <em>ukraina</em> — \"borderland\" or \"region, country.\""},
   people:[{n:"Volodymyr the Great",r:"grand prince who Christianized Kyivan Rus'",img:"Coin_of_Vladimir_the_Great.JPG"},{n:"Bohdan Khmelnytsky",r:"Cossack hetman who founded a Ukrainian state",img:"Bohdan_Khmelnytsky_(Portrait,_sec._half_17th_century,_Chernihiv_Historical_Museum)_(cropped).jpg"},{n:"Taras Shevchenko",r:"national poet — father of modern Ukrainian literature",img:"Т._Г._Шевченко._Квітень_1859.jpg"},{n:"Lesya Ukrainka",r:"pioneering poet & playwright",img:"Lesya_Ukrainka_portrait.jpg"},{n:"Ivan Mazepa",r:"Cossack hetman & patron of the arts",img:"Iwan_Mazepa_crop.jpg"}],
   art:{n:"Kazimir Malevich",r:"Suprematist abstraction pioneer",img:"Casimir_Malevich_photo.jpg"}, writer:{n:"Taras Shevchenko",r:"National poet and painter",img:"Т._Г._Шевченко._Квітень_1859.jpg"}, stage:{n:"Milla Jovovich",r:"Action-film star and model",img:"Milla_Jovovich_-_Protector.jpg"}, music:{n:"Jamala",r:"singer who won Eurovision 2016 with \"1944\"",img:"Jamala_Volia_Space_2024_(cropped).png"},
   sports:{n:"Andriy Shevchenko",r:"Ballon d'Or striker — Ukraine's football icon",img:"Андрій_Шевченко_2024_(cropped).png"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ukraine"},{label:"Facts & figures",detail:"Wikipedia — \"Ukraine\" & related articles",url:"https://en.wikipedia.org/wiki/Ukraine"},{label:"Travel film",detail:"YouTube — \"Top 10 Places To Visit In Ukraine\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=lAyWhJ6tr9E"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ukraine/@48.4,31,6z"}] },
  SE: { tagline:"Sverige · midnight sun, deep forests, and pop perfected",
   photos:[{f:"Gamla_stan_September_2014_01.jpg",cap:"Gamla Stan · Stockholm's old town"},{f:"Göteborg_2503_stitch_(28573994096).jpg",cap:"Gothenburg · the west-coast harbor city"},{f:"Abisko_overview.JPG",cap:"Abisko · aurora country in Lapland"},{f:"Church_of_Kiruna_2011.jpg",cap:"Kiruna · the Arctic town"},{f:"Öland_panorama_mot_Östersjön_01.JPG",cap:"Öland · Baltic coast horizons"},{f:"1285Kalmar_slott.jpg",cap:"Kalmar Castle · Renaissance stronghold"},{f:"0522Visby_domkyrka.jpg",cap:"Visby · medieval Gotland"},{f:"Swedish_Summer_Dream_-_Flickr_-_northofsweden.jpg",cap:"Red cottages · lakeside summer"},{f:"ICEHOTEL_Main_Hall_(2014)_by_Alessandro_Falca_&_AnnaSofia_Mååg.jpg",cap:"Icehotel · rebuilt every winter in Jukkasjärvi"},{f:"Pierikpakte_in_Sarek.jpg",cap:"Sarek · roadless wilderness"}],
   video:{id:"aFI-utCFov0",title:"Sweden Travel Guide | 6 Best Places to Visit",by:"Travel Navigator"},
   cities:[{name:"Stockholm",lng:18.07,lat:59.33,capital:true},{name:"Gothenburg",lng:11.97,lat:57.71},{name:"Malmö",lng:13.00,lat:55.61},{name:"Uppsala",lng:17.64,lat:59.86},{name:"Västerås",lng:16.55,lat:59.61},{name:"Örebro",lng:15.21,lat:59.27},{name:"Linköping",lng:15.62,lat:58.41}],
   maps:"https://www.google.com/maps/place/Sweden/@62.2,17.6,4z",
   facts:{capital:"Stockholm",population:"≈ 10.6 million (2024)",languages:"Swedish (official); 5 recognized minority languages",langCount:"≈ 15 languages spoken in total",independence:"Consolidated as a kingdom in the Middle Ages; left the Kalmar Union June 6, 1523 (National Day)",government:"Unitary parliamentary constitutional monarchy",etymology:"From the <em>Svear</em> (Swedes) — \"land of the Swedes.\""},
   people:[{n:"Gustav Vasa",r:"founding king — broke the Kalmar Union",img:"Gustav_Vasa.jpg"},{n:"Gustavus Adolphus",r:"\"Lion of the North\" — warrior king",img:"Attributed_to_Jacob_Hoefnagel_-_Gustavus_Adolphus,_King_of_Sweden_1611-1632_-_Google_Art_Project.jpg"},{n:"Carl Linnaeus",r:"father of modern taxonomy",img:"Carolus_Linnaeus_(cleaned_up_version).jpg"},{n:"Alfred Nobel",r:"chemist — founder of the Nobel Prizes",img:"Alfred_Nobel3.jpg"},{n:"Raoul Wallenberg",r:"diplomat who saved thousands from the Holocaust",img:"Raoul_Wallenberg.jpg"}],
   art:{n:"Anders Zorn",r:"Master portrait and nude painter",img:"Anders_Zorn_1908.jpg"}, writer:{n:"Astrid Lindgren",r:"Beloved children's-book author",img:"Astrid_Lindgren_(cropped).jpg"}, stage:{n:"Greta Garbo",r:"Enigmatic Hollywood screen legend",img:"Garbo_in_Inspiration.jpg"}, music:{n:"ABBA",r:"the best-selling Swedish act of all time",img:"ABBA_-_TopPop_1974_5.png"},
   sports:{n:"Zlatan Ibrahimović",r:"prolific striker — Sweden's football icon",img:"Zlatan_Ibrahimović_June_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Sweden"},{label:"Facts & figures",detail:"Wikipedia — \"Sweden\" & related articles",url:"https://en.wikipedia.org/wiki/Sweden"},{label:"Travel film",detail:"YouTube — \"Sweden Travel Guide\" · Travel Navigator",url:"https://www.youtube.com/watch?v=aFI-utCFov0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Sweden/@62.2,17.6,4z"}] },
  CH: { tagline:"Confoederatio Helvetica · four languages, one alpine heart",
   photos:[{f:"Matterhorn_from_Domhütte_-_2.jpg",cap:"The Matterhorn · above Zermatt"},{f:"1_zermatt_evening_2022.jpg",cap:"Zermatt · car-free alpine village"},{f:"Jungfrau03.jpg",cap:"The Jungfrau · Bernese Alps"},{f:"North_face.jpg",cap:"The Eiger's north face"},{f:"1_lauterbrunnen_valley_wengen_2022.jpg",cap:"Lauterbrunnen · the valley of 72 waterfalls"},{f:"001_Chateau_de_Chillon_and_Dents_du_Midi_Photo_by_Giles_Laurent.jpg",cap:"Château de Chillon · Lake Geneva"},{f:"Kapellbruecke.JPG",cap:"Chapel Bridge · Lucerne"},{f:"Bundeshaus_Bern_2009,_Flooffy.jpg",cap:"Federal Palace · Bern old town"},{f:"Goldswil-Viadukt_Panorama_mit_Interlaken_im_Hintergrund_2.jpg",cap:"Interlaken · between two lakes"},{f:"20190725_Oeschinensee-Panorama,_Kandersteg_(06540-42_stitch).jpg",cap:"Lake Oeschinen · a turquoise mountain lake"}],
   video:{id:"z4lkEJ7qpnI",title:"Switzerland Travel · A 6-Day Road Trip Itinerary",by:"World Wild Hearts"},
   cities:[{name:"Bern",lng:7.447,lat:46.948,capital:true},{name:"Zürich",lng:8.541,lat:47.377},{name:"Geneva",lng:6.147,lat:46.202},{name:"Basel",lng:7.591,lat:47.555},{name:"Lausanne",lng:6.633,lat:46.520},{name:"Lucerne",lng:8.300,lat:47.050},{name:"St. Gallen",lng:9.371,lat:47.424},{name:"Lugano",lng:8.953,lat:46.005}],
   maps:"https://www.google.com/maps/place/Switzerland/@46.8,8.2,7z",
   facts:{capital:"Bern (the \"federal city\")",population:"≈ 8.9 million (2024)",languages:"German, French, Italian & Romansh (all official)",langCount:"≈ 25 languages spoken in total",independence:"Founded 1291 (Federal Charter); independence recognized 1648 (Peace of Westphalia)",government:"Federal semi-direct democratic republic",etymology:"From the canton of <em>Schwyz</em>; the Latin name <em>Confoederatio Helvetica</em> gives the code <em>CH</em>."},
   people:[{n:"Henri Dunant",r:"founder of the Red Cross — first Nobel Peace Prize",img:"Henry_Dunant-young.jpg"},{n:"William Tell",r:"legendary folk hero of Swiss independence",img:"2019 Tell Monument Statue (Telldenkmal) Altdorf Uri Switzerland Ank Kumar Infosys Limited 03.jpg"},{n:"Le Corbusier",r:"pioneer of modern architecture",img:"Le_Corbusier_(1964).jpg"},{n:"Leonhard Euler",r:"one of history's greatest mathematicians",img:"Leonhard_Euler_-_Jakob_Emanuel_Handmann_(Kunstmuseum_Basel).jpg"},{n:"Carl Jung",r:"founder of analytical psychology",img:"Carl Gustav Jung portrait.jpg"}],
   art:{n:"Alberto Giacometti",r:"Elongated existential bronze sculptor",img:"Emmy_Andriesse_-_Alberto_Giacometti_(Ende_1940er_PK-F-A.06801).jpg"}, writer:{n:"Hermann Hesse",r:"Nobel novelist of inward journeys",img:"Hermann_Hesse_2.jpg"}, stage:{n:"Ursula Andress",r:"Iconic Bond-film screen actress",img:"Ursula_Andress_at_Somerset_House_in_2004.JPG"}, music:{n:"DJ BoBo",r:"globe-touring Eurodance star",img:"DJ_Bobo,_Ergo_Arena,_02.11.2024_39.jpg"},
   sports:{n:"Roger Federer",r:"20-time Grand Slam tennis champion",img:"Roger_Federer_2015_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Switzerland"},{label:"Facts & figures",detail:"Wikipedia — \"Switzerland\" & related articles",url:"https://en.wikipedia.org/wiki/Switzerland"},{label:"Travel film",detail:"YouTube — \"Switzerland Travel · 6-Day Road Trip\" · World Wild Hearts",url:"https://www.youtube.com/watch?v=z4lkEJ7qpnI"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Switzerland/@46.8,8.2,7z"}] },
  PH: { tagline:"Perlas ng Silangan · 7,641 islands where the Pacific meets the tropics",
   photos:[{f:"El_Nido_Bay_December_2018.jpg",cap:"El Nido limestone karsts · Palawan"},{f:"Banaue-terrace.JPG",cap:"Banaue Rice Terraces · Ifugao"},{f:"Chocolate_Hills_Bohol.JPG",cap:"The Chocolate Hills · Bohol"},{f:"Cityscape_of_Manila,_2025_(01).jpg",cap:"Manila skyline"},{f:"Boracay_White_Beach.png",cap:"White Beach · Boracay"},{f:"Mount_Mayon_Cagsawa_field_view_close-up_(Busay,_Daraga,_Albay;_04-21-2023).jpg",cap:"Mayon Volcano over Cagsawa · Albay"},{f:"Cebu_City_2026_skyline1.jpg",cap:"Cebu City skyline"},{f:"Allan_Jay_Quesada_-_Vigan_Cathedral_001.jpg",cap:"Spanish-colonial Vigan · Ilocos Sur"},{f:"Kayangan_Lake,_Coron_-_Palawan.jpg",cap:"Kayangan Lake · Coron, Palawan"},{f:"Coron_skyline_Tapyas_(Coron,_Palwan;_03-16-2024).jpg",cap:"Coron town from Mt. Tapyas · Palawan"}],
   video:{id:"pOvVsbN9DZg",title:"The Philippines · Cinematic Travel Film 2024",by:"Michael2160p"},
   cities:[{name:"Manila",lng:120.98,lat:14.60,capital:true},{name:"Quezon City",lng:121.04,lat:14.68},{name:"Davao",lng:125.61,lat:7.19},{name:"Cebu City",lng:123.89,lat:10.32},{name:"Zamboanga",lng:122.08,lat:6.92},{name:"Cagayan de Oro",lng:124.65,lat:8.48},{name:"Iloilo",lng:122.57,lat:10.72},{name:"Baguio",lng:120.59,lat:16.41}],
   maps:"https://www.google.com/maps/place/Philippines/@12.9,121.8,5z",
   facts:{capital:"Manila",population:"≈ 114 million (2024)",languages:"Filipino & English (official)",langCount:"≈ 180+ languages spoken in total",independence:"June 12, 1898 — declared from Spain; July 4, 1946 — from the US",government:"Unitary presidential republic",etymology:"Named after King <em>Philip II of Spain</em> — <em>Las Islas Filipinas</em>."},
   people:[{n:"José Rizal",r:"national hero — writer whose novels sparked the revolution",img:"Jose_Rizal_full.jpg"},{n:"Andrés Bonifacio",r:"founder of the Katipunan — father of the revolution",img:"Andrés_Bonifacio_photo_(cropped).jpg"},{n:"Emilio Aguinaldo",r:"first president of the Philippines",img:"Emilio_Aguinaldo_ca._1919_(Restored).jpg"},{n:"Apolinario Mabini",r:"the \"Brains of the Revolution\"",img:"Apolinario_Mabini.jpg"},{n:"Melchora Aquino",r:"\"Tandang Sora\" — mother of the revolution",img:"Melchora_Aquino_de_Ramos.jpg"}],
   art:{n:"Juan Luna",r:"Historic Spoliarium history painter",img:"Luna_1899.png"}, writer:{n:"José Rizal",r:"National hero and novelist",img:"Jose_Rizal_full.jpg"}, stage:{n:"Lea Salonga",r:"Tony-winning stage actress",img:"LeaSalonga-byPhilipRomano_(cropped).jpg"}, music:{n:"Lea Salonga",r:"Tony-winning voice of Broadway & Disney",img:"LeaSalonga-byPhilipRomano_(cropped).jpg"},
   sports:{n:"Manny Pacquiao",r:"8-division world boxing champion",img:"Former_senator_Manny_Pacquiao_speaks_in_event_(10-01-2025)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Philippines"},{label:"Facts & figures",detail:"Wikipedia — \"Philippines\" & related articles",url:"https://en.wikipedia.org/wiki/Philippines"},{label:"Travel film",detail:"YouTube — \"The Philippines · Cinematic Travel Film 2024\" · Michael2160p",url:"https://www.youtube.com/watch?v=pOvVsbN9DZg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Philippines/@12.9,121.8,5z"}] },
  RU: {"tagline":"Россия · Empire of Endless Horizons","photos":[{"f":"Saint Basil's Cathedral in Moscow.jpg","cap":"St. Basil's Cathedral, Moscow"},{"f":"Kremlin and Red Square.1.jpg","cap":"The Kremlin and Red Square"},{"f":"RUS-2016-Aerial-SPB-Winter_Palace_(crop).jpg","cap":"Winter Palace, St. Petersburg"},{"f":"Auferstehungskirche (Sankt Petersburg).JPG","cap":"Church of the Savior on Blood"},{"f":"Peterhof_Palace,_Saint_Petersburg,_Russia_(44408938295).jpg","cap":"Peterhof Palace fountains"},{"f":"Baikal.A2001296.0420.250m-NASA.jpg","cap":"Lake Baikal from above"},{"f":"Kizhi_06-2017_img08_Pogost_view.jpg","cap":"Wooden churches of Kizhi Pogost"},{"f":"Казанский кремль. Панорама с колеса обозрения.jpg","cap":"Kazan Kremlin panorama"},{"f":"Sochi_harbour.jpg","cap":"Sochi on the Black Sea"},{"f":"Mount_Elbrus_(cropped).jpg","cap":"Mount Elbrus, Europe's highest peak"}],"video":{"id":"iaobQeIkpIs","title":"Train Moscow to St. Petersburg | Russia Travel Vlog","by":"Svenywhere: Travel Exploration"},"cities":[{"name":"Moscow","lng":37.6173,"lat":55.7558,"capital":true},{"name":"Saint Petersburg","lng":30.3351,"lat":59.9343},{"name":"Novosibirsk","lng":82.9204,"lat":55.0084},{"name":"Yekaterinburg","lng":60.5975,"lat":56.8389},{"name":"Kazan","lng":49.1221,"lat":55.7963},{"name":"Vladivostok","lng":131.8855,"lat":43.1155},{"name":"Sochi","lng":39.7303,"lat":43.6028}],"maps":"https://www.google.com/maps/place/Russia/@61.5240,105.3188,3z","facts":{"capital":"Moscow","population":"≈ 144 million (2024)","languages":"Russian","langCount":"1 official / 100+ spoken","independence":"1991 (dissolution of the USSR)","government":"Federal semi-presidential republic","etymology":"The name derives from <em>Rus'</em>, the medieval state of the Eastern Slavs, likely rooted in an Old Norse term for the Varangians who traded and settled along its rivers."},"people":[{"n":"Pyotr Ilyich Tchaikovsky","r":"Romantic composer","img":"Tchaikovsky_by_Reutlinger_(cropped).jpg"},{"n":"Leo Tolstoy","r":"Novelist","img":"Leo_Tolstoy_1908_Portrait_(3x4_cropped).jpg"},{"n":"Yuri Gagarin","r":"First human in space","img":"Yuri_Gagarin_with_awards_(cropped)_2.jpg"},{"n":"Maya Plisetskaya","r":"Prima ballerina","img":"Майя Плисецкая - Тихонов Никита Сергеевич - Tikhonov Nikita- Большой театр -2005 (cropped).jpg"},{"n":"Ilya Repin","r":"Realist painter","img":"RepinSelfPortrait_(cropped).jpg"}],"music":{"n":"Pyotr Ilyich Tchaikovsky","r":"Romantic composer","img":"Tchaikovsky_by_Reutlinger_(cropped).jpg"},"art":{"n":"Ilya Repin","r":"Realist painter","img":"RepinSelfPortrait_(cropped).jpg"},"writer":{"n":"Fyodor Dostoevsky","r":"Novelist","img":"Vasily_Perov_-_Портрет_Ф.М.Достоевского_-_Google_Art_Project.jpg"},"stage":{"n":"Maya Plisetskaya","r":"Bolshoi prima ballerina","img":"Майя Плисецкая - Тихонов Никита Сергеевич - Tikhonov Nikita- Большой театр -2005 (cropped).jpg"},"sports":{"n":"Maria Sharapova","r":"Grand Slam tennis champion","img":"Collision_2024_-_VR7_1035_(53801820852)_(cropped).jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Russia category","url":"https://commons.wikimedia.org/wiki/Category:Russia"},{"label":"Facts","detail":"Wikipedia — Russia","url":"https://en.wikipedia.org/wiki/Russia"},{"label":"Travel film","detail":"Svenywhere: Travel Exploration","url":"https://www.youtube.com/watch?v=iaobQeIkpIs"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Russia","url":"https://www.google.com/maps/place/Russia/@61.5240,105.3188,3z"}]},
  ID: {"tagline":"Indonesia · Thousands of Islands, One Nation","photos":[{"f":"Borobudur-Temple-Park Indonesia Stupas-of-Borobudur-01.jpg","cap":"Stupas of Borobudur, Central Java"},{"f":"Yogyakarta Indonesia Prambanan-temple-complex-21.jpg","cap":"Prambanan Hindu temple complex, Yogyakarta"},{"f":"Jakarta Panorama.jpg","cap":"Panoramic skyline of Jakarta"},{"f":"Tegallalang Rice Terraces Bali.jpg","cap":"Tegallalang rice terraces, Bali"},{"f":"Gunung Bromo sunrise - Indonesia.jpg","cap":"Sunrise over Mount Bromo, East Java"},{"f":"Tanah-Lot Bali Indonesia Pura-Tanah-Lot-01.jpg","cap":"Pura Tanah Lot sea temple, Bali"},{"f":"Raja Ampat, Papua.jpg","cap":"Karst islands of Raja Ampat, West Papua"},{"f":"Piaynemo Island, Raja Ampat, West Papua, Indonesia.jpg","cap":"Piaynemo viewpoint, Raja Ampat"},{"f":"Tongkonan traditionnal Toraja house.jpg","cap":"Tongkonan houses of the Toraja, Sulawesi"},{"f":"Tongkonan, Toraja houses.jpg","cap":"Saddleback-roofed Tongkonan, Tana Toraja"}],"video":{"id":"Vl5y_nMDgtM","title":"We Left Bali: This is Why 🇮🇩 Indonesia Travel Vlog 2024","by":"Mike and Ashley"},"cities":[{"name":"Jakarta","lng":106.8456,"lat":-6.2088,"capital":true},{"name":"Surabaya","lng":112.7521,"lat":-7.2575},{"name":"Bandung","lng":107.6098,"lat":-6.9175},{"name":"Medan","lng":98.6722,"lat":3.5952},{"name":"Semarang","lng":110.4203,"lat":-6.9667},{"name":"Yogyakarta","lng":110.3695,"lat":-7.7956},{"name":"Denpasar","lng":115.2126,"lat":-8.6705},{"name":"Makassar","lng":119.4238,"lat":-5.1477}],"maps":"https://www.google.com/maps/place/Indonesia/@-2.5489,118.0149,5z","facts":{"capital":"Jakarta","population":"≈ 281 million (2024)","languages":"Indonesian (Bahasa Indonesia)","langCount":"1 official / 700+ spoken","independence":"17 August 1945 (from the Netherlands)","government":"Unitary presidential republic","etymology":"From the Greek <em>Indos</em> (India) and <em>nesos</em> (islands), meaning \"Indian Islands.\""},"people":[{"n":"Sukarno","r":"Founding president","img":"Presiden_Sukarno.jpg"},{"n":"Prabowo Subianto","r":"Current president","img":"Prabowo_Subianto_2024_official_portrait.jpg"},{"n":"Raden Ajeng Kartini","r":"Women's rights heroine","img":"COLLECTIE_TROPENMUSEUM_Portret_van_Raden_Ajeng_Kartini_TMnr_10018776.jpg"},{"n":"Suharto","r":"Second president","img":"Official_portrait_of_Soeharto_(1980s).jpg"},{"n":"B. J. Habibie","r":"President and aerospace engineer","img":"B._J._Habibie,_President_of_Indonesia_portrait.jpg"}],"music":{"n":"Rhoma Irama","r":"\"King of Dangdut\"","img":"Rhoma_Irama_gives_lecture.jpg"},"art":{"n":"Affandi","r":"Pioneering expressionist painter","img":"Affandi_in_Paris_Exhibition,_Indonesian_Affairs_April-May_1953,_front_cover_(cropped).jpg"},"writer":{"n":"Pramoedya Ananta Toer","r":"Novelist, Buru Quartet","img":"Pramoedya_Ananta_Toer_Kesusastraan_Indonesia_Modern_dalam_Kritik_dan_Essai_1_(1962)_p136.jpg"},"stage":{"n":"Christine Hakim","r":"Acclaimed film actress","img":"Christine_Hakim.jpg"},"sports":{"n":"Susi Susanti","r":"Olympic badminton champion","img":"Susi_Susanti.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Indonesia category","url":"https://commons.wikimedia.org/wiki/Category:Indonesia"},{"label":"Facts","detail":"Wikipedia — Indonesia","url":"https://en.wikipedia.org/wiki/Indonesia"},{"label":"Travel film","detail":"Mike and Ashley on YouTube","url":"https://www.youtube.com/watch?v=Vl5y_nMDgtM"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Indonesia","url":"https://www.google.com/maps/place/Indonesia/@-2.5489,118.0149,5z"}]},
  VE: {"tagline":"Venezuela · Where Angels Fall From Tepuis","photos":[{"f":"Salto del Angel-Canaima-Venezuela07.JPG","cap":"Angel Falls, the world's tallest waterfall"},{"f":"Angel Falls Venezuela.jpg","cap":"Aerial view of Angel Falls and Auyán-tepui"},{"f":"Laguna de Canaima.jpg","cap":"Canaima Lagoon, Bolívar state"},{"f":"Skyline Caracas.jpg","cap":"Caracas skyline beneath El Ávila"},{"f":"Cerro El Ávila - Caracas.jpg","cap":"Cerro El Ávila rising over the capital"},{"f":"Cayo de Agua, Archipiélago de Los Roques, Venezuela.jpg","cap":"Cayo de Agua, Los Roques archipelago"},{"f":"Cayo Lanqui, Los Roques, Venezuela.jpg","cap":"Turquoise shallows at Cayo Lanqui"},{"f":"Cabina del Sistema Teleférico de Mérida Mukumbarí.jpg","cap":"Mukumbarí cable car, Mérida"},{"f":"Dunas de los Medanos de Coro, Falcón Venezuela.jpg","cap":"Médanos de Coro dunes, Falcón"},{"f":"CHORONI ESTADO ARAGUA 08.JPG","cap":"Caribbean coast at Choroní, Aragua"}],"video":{"id":"-6FRxYirzho","title":"VENEZUELA: The True Lost World | 4K Documentary","by":"Infinite Planet TV"},"cities":[{"name":"Caracas","lng":-66.9036,"lat":10.4806,"capital":true},{"name":"Maracaibo","lng":-71.6125,"lat":10.6545},{"name":"Valencia","lng":-68.0125,"lat":10.162},{"name":"Barquisimeto","lng":-69.3467,"lat":10.0678},{"name":"Maracay","lng":-67.5958,"lat":10.2469},{"name":"Ciudad Guayana","lng":-62.6417,"lat":8.3533},{"name":"Mérida","lng":-71.1561,"lat":8.5897},{"name":"Maturín","lng":-63.1832,"lat":9.7457}],"maps":"https://www.google.com/maps/place/Venezuela/@6.4238,-66.5897,6z","facts":{"capital":"Caracas","population":"≈ 28 million (2024)","languages":"Spanish (plus 30+ indigenous languages)","langCount":"1 official / 40+ spoken","independence":"5 July 1811 (from Spain)","government":"Federal presidential republic","etymology":"Named <em>Veneziola</em> ('little Venice') by explorers who saw stilt houses on Lake Maracaibo evoking Venice."},"people":[{"n":"Simón Bolívar","r":"Independence liberator, statesman","img":"Simón Bolívar 2.jpg"},{"n":"Rómulo Gallegos","r":"Novelist, first elected president","img":"Rómulo Gallegos.jpg"},{"n":"Carlos Cruz-Diez","r":"Pioneering kinetic artist","img":"Carlos Cruz-Diez.jpg"},{"n":"Teresa Carreño","r":"Virtuoso concert pianist","img":"Teresa Carreño (1885).jpg"},{"n":"Miguel Cabrera","r":"Baseball Triple Crown slugger","img":"Miguel Cabrera in 2014.jpg"}],"music":{"n":"Teresa Carreño","r":"Virtuoso pianist and composer","img":"Teresa Carreño (1885).jpg"},"art":{"n":"Carlos Cruz-Diez","r":"Master of kinetic art","img":"Carlos Cruz-Diez.jpg"},"writer":{"n":"Rómulo Gallegos","r":"Author of Doña Bárbara","img":"Rómulo Gallegos.jpg"},"stage":{"n":"Édgar Ramírez","r":"Film and TV actor","img":"Edgar Ramirez by Gage Skidmore.jpg"},"sports":{"n":"Miguel Cabrera","r":"MLB Hall-of-Fame-bound hitter","img":"Miguel Cabrera in 2014.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category:Venezuela","url":"https://commons.wikimedia.org/wiki/Category:Venezuela"},{"label":"Facts","detail":"Wikipedia — Venezuela","url":"https://en.wikipedia.org/wiki/Venezuela"},{"label":"Travel film","detail":"VENEZUELA: The True Lost World — Infinite Planet TV","url":"https://www.youtube.com/watch?v=-6FRxYirzho"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Venezuela","url":"https://www.google.com/maps/place/Venezuela/@6.4238,-66.5897,6z"}]},
  CL: {"tagline":"Chile · Land at the End of the World","photos":[{"f":"Autumn in parque nacional Torres del Paine.jpg","cap":"Torres del Paine granite peaks in autumn"},{"f":"Bajo la lluvia en la Cordillera Paine, Parque nacional Torres del Paine, Chile.jpg","cap":"Cordillera Paine under Patagonian rain"},{"f":"Los cerros de Valparaiso (32112979738).jpg","cap":"Colorful hillside houses of Valparaíso"},{"f":"Santiago Skyline.jpg","cap":"Santiago skyline beneath the Andes"},{"f":"Montañas alrededor de Santiago 2.JPG","cap":"Snowcapped mountains ringing Santiago"},{"f":"Atacama Desert Panorama (img 2303).jpg","cap":"Vast Atacama Desert panorama"},{"f":"A winding road through the Atacama Desert (dji-20240605184824-ang).jpg","cap":"Lonely road crossing the Atacama"},{"f":"A lake in the desert (mg 0007-editar-cc).jpg","cap":"Altiplano lagoon in the desert"},{"f":"Ahu Tongariki.jpg","cap":"Moai row at Ahu Tongariki, Rapa Nui"},{"f":"Chile 2015-11-15 (23637654494).jpg","cap":"Turquoise lakes of Chilean Patagonia"}],"video":{"id":"gd4m-zLY2sI","title":"Inside Deep Patagonia With a Chilean I Just Met..","by":"Nomadic Tour"},"cities":[{"name":"Santiago","lng":-70.6483,"lat":-33.4569,"capital":true},{"name":"Valparaíso","lng":-71.6127,"lat":-33.0472},{"name":"Concepción","lng":-73.0498,"lat":-36.8201},{"name":"Antofagasta","lng":-70.4,"lat":-23.6509},{"name":"La Serena","lng":-71.25,"lat":-29.9027},{"name":"Temuco","lng":-72.5904,"lat":-38.7359},{"name":"Punta Arenas","lng":-70.9171,"lat":-53.1638}],"maps":"https://www.google.com/maps/place/Chile/@-35.6751,-71.5430,4z","facts":{"capital":"Santiago","population":"≈ 19.6 million (2024)","languages":"Spanish","langCount":"1 official / 10+ spoken","independence":"February 12, 1818 (from Spain)","government":"Unitary presidential republic","etymology":"The name likely comes from the indigenous Mapuche word <em>chilli</em>, meaning \"where the land ends,\" or from a native word for a bird's call."},"people":[{"n":"Gabriela Mistral","r":"Nobel-winning poet","img":"Gabriela Mistral 1945.jpg"},{"n":"Pablo Neruda","r":"Nobel-winning poet","img":"Pablo Neruda 1963.jpg"},{"n":"Isabel Allende","r":"Best-selling novelist","img":"Isabel Allende - 001.jpg"},{"n":"Violeta Parra","r":"Folk musician and artist","img":"Violeta Parra.jpg"},{"n":"Alexis Sánchez","r":"International footballer","img":"Alexis Sanchez Cobreloa20171.png"}],"music":{"n":"Violeta Parra","r":"Nueva Canción folk pioneer","img":"Violeta Parra.jpg"},"art":{"n":"Roberto Matta","r":"Surrealist painter","img":"Matta revista cleaned.jpg"},"writer":{"n":"Pablo Neruda","r":"Nobel laureate poet","img":"Pablo Neruda 1963.jpg"},"stage":{"n":"Pedro Pascal","r":"Film and television actor","img":""},"sports":{"n":"Alexis Sánchez","r":"Football forward, national team","img":"Alexis Sanchez Cobreloa20171.png"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: Chile","url":"https://commons.wikimedia.org/wiki/Category:Chile"},{"label":"Facts","detail":"Wikipedia — Chile","url":"https://en.wikipedia.org/wiki/Chile"},{"label":"Travel film","detail":"Nomadic Tour on YouTube","url":"https://www.youtube.com/watch?v=gd4m-zLY2sI"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Chile","url":"https://www.google.com/maps/place/Chile/@-35.6751,-71.5430,4z"}]},
  SA: {"tagline":"المملكة العربية السعودية · Deserts, cities, ancient stone","photos":[{"f":"Al Ula old town, Saudi Arabia 2011.jpg","cap":"AlUla old town, mud-brick heritage quarter"},{"f":"27, Hegra (Mada'in Salih), Saudi Arabia.jpg","cap":"Hegra (Madain Salih), Nabataean tombs"},{"f":"Edge of the World.jpg","cap":"Edge of the World cliffs near Riyadh"},{"f":"Riyadh Skyline.jpg","cap":"Riyadh skyline and Kingdom Centre tower"},{"f":"Masmak castle.jpg","cap":"Al Masmak Fortress, historic Riyadh"},{"f":"Rub al Khali 002.JPG","cap":"Rub al-Khali, the Empty Quarter dunes"},{"f":"Diriyahpic.jpg","cap":"Diriyah, birthplace of the Saudi state"},{"f":"Old Jeddah (Al Balad), Saudi Arabia in November 2022.jpg","cap":"Al-Balad, old Jeddah's coral-stone houses"},{"f":"Jeddah Corniche 18.jpg","cap":"Jeddah Corniche along the Red Sea"},{"f":"Farasan Island Mangroves.jpg","cap":"Farasan Islands mangroves, southern Red Sea"}],"video":{"id":"jJ8I4mjxeF0","title":"My 3-day solo trip to Riyadh, Saudi Arabia 🇸🇦","by":"WorldwideWu"},"cities":[{"name":"Riyadh","lng":46.6753,"lat":24.7136,"capital":true},{"name":"Jeddah","lng":39.1925,"lat":21.4858},{"name":"Mecca","lng":39.8579,"lat":21.3891},{"name":"Medina","lng":39.6142,"lat":24.5247},{"name":"Dammam","lng":50.1033,"lat":26.4207},{"name":"AlUla","lng":37.9146,"lat":26.6089},{"name":"Abha","lng":42.5053,"lat":18.2465},{"name":"Tabuk","lng":36.555,"lat":28.3835}],"maps":"https://www.google.com/maps/place/Saudi+Arabia/@23.8859,45.0792,5z","facts":{"capital":"Riyadh","population":"≈ 35 million (2024)","languages":"Arabic","langCount":"1 official / 10+ spoken","independence":"Unified 23 September 1932 (Kingdom founded)","government":"Unitary Islamic absolute monarchy","etymology":"Named for the ruling <em>House of Saud</em>, the dynasty that unified the kingdom in 1932."},"people":[{"n":"King Salman bin Abdulaziz","r":"King of Saudi Arabia","img":""},{"n":"Mohammed bin Salman","r":"Crown prince, prime minister","img":""},{"n":"Ibn Saud","r":"Founding king of the kingdom","img":""},{"n":"Mohammed Abdu","r":"Beloved singer, 'Artist of Arabs'","img":"Mohammed Abdu.jpg"},{"n":"Ahmed Mater","r":"Contemporary visual artist","img":"AHMED MATER SAUDIARABIA 2004.jpg"}],"music":{"n":"Mohammed Abdu","r":"Singer, 'Artist of the Arabs'","img":"Mohammed Abdu.jpg"},"art":{"n":"Ahmed Mater","r":"Contemporary visual artist","img":"AHMED MATER SAUDIARABIA 2004.jpg"},"writer":{"n":"Abdulrahman Munif","r":"Novelist, 'Cities of Salt'","img":""},"stage":{"n":"Nasser Al-Qasabi","r":"Actor and comedian","img":"Naser AlQasabi.png"},"sports":{"n":"Salem Al-Dawsari","r":"Footballer, Al-Hilal and national team","img":"Salem Al-Dawsari.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: Saudi Arabia","url":"https://commons.wikimedia.org/wiki/Category:Saudi_Arabia"},{"label":"Facts","detail":"Wikipedia — Saudi Arabia","url":"https://en.wikipedia.org/wiki/Saudi_Arabia"},{"label":"Travel film","detail":"My 3-day solo trip to Riyadh — WorldwideWu","url":"https://www.youtube.com/watch?v=jJ8I4mjxeF0"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Saudi Arabia","url":"https://www.google.com/maps/place/Saudi+Arabia/@23.8859,45.0792,5z"}]},
  NZ: {"tagline":"Aotearoa · Where mountains meet the sea","photos":[{"f":"Milford Sound New Zealand 2016.jpg","cap":"Milford Sound, Fiordland"},{"f":"Mount Cook, New Zealand.jpg","cap":"Aoraki / Mount Cook"},{"f":"Church of the Good Shepherd, Lake Tekapo.jpg","cap":"Church of the Good Shepherd, Lake Tekapo"},{"f":"Queenstown, New Zealand.jpg","cap":"Queenstown on Lake Wakatipu"},{"f":"Lake Wanaka Tree.jpg","cap":"The lone tree of Lake Wanaka"},{"f":"A view of Hobbiton from the Green Dragon Inn, Hobbiton Movie Set, Matamata, New Zealand 2016 (50796593188).jpg","cap":"Hobbiton movie set, Matamata"},{"f":"Champagne Pool.jpg","cap":"Champagne Pool, Wai-O-Tapu, Rotorua"},{"f":"Cathedral Cove.jpg","cap":"Cathedral Cove, Coromandel"},{"f":"Moeraki Boulders.jpg","cap":"Moeraki Boulders, Otago coast"},{"f":"Wellington from Mount Victoria.jpg","cap":"Wellington from Mount Victoria"}],"video":{"id":"nqmrFegVTEA","title":"New Zealand VLOG: 2 Weeks Roadtripping the South Island","by":"Taylor Bell"},"cities":[{"name":"Wellington","lng":174.7762,"lat":-41.2865,"capital":true},{"name":"Auckland","lng":174.7633,"lat":-36.8485},{"name":"Christchurch","lng":172.6362,"lat":-43.5321},{"name":"Hamilton","lng":175.2793,"lat":-37.787},{"name":"Queenstown","lng":168.6626,"lat":-45.0312},{"name":"Dunedin","lng":170.5028,"lat":-45.8788},{"name":"Rotorua","lng":176.2497,"lat":-38.1368},{"name":"Napier","lng":176.912,"lat":-39.4928}],"maps":"https://www.google.com/maps/place/New+Zealand/@-41.2865,174.7762,5z","facts":{"capital":"Wellington","population":"≈ 5.3 million (2024)","languages":"English, Māori, NZ Sign Language","langCount":"3 official / 20+ spoken","independence":"Dominion 1907; full independence 1947","government":"Unitary parliamentary constitutional monarchy","etymology":"Anglicized from the Latin \"Nova Zeelandia,\" named by Dutch cartographers after the Dutch province of <em>Zeeland</em>."},"people":[{"n":"Kiri Te Kanawa","r":"World-renowned opera soprano","img":"Kiri Te Kanawa.jpg"},{"n":"Edmund Hillary","r":"First to summit Everest","img":"Sir Edmund Hillary.jpg"},{"n":"Katherine Mansfield","r":"Modernist short-story writer","img":"Katherinemansfield.jpg"},{"n":"Richie McCaw","r":"All Blacks rugby captain","img":"Richie McCaw 2011.jpg"},{"n":"Sam Neill","r":"Film and television actor","img":"Sam Neill.jpg"}],"music":{"n":"Lorde","r":"Grammy-winning pop singer-songwriter","img":"Lorde ARIA Music Awards.jpg"},"art":{"n":"Colin McCahon","r":"Foremost modernist painter","img":""},"writer":{"n":"Katherine Mansfield","r":"Modernist short-story pioneer","img":"Katherinemansfield.jpg"},"stage":{"n":"Sam Neill","r":"Acclaimed screen actor","img":"Sam Neill.jpg"},"sports":{"n":"Richie McCaw","r":"Two-time World Cup All Blacks captain","img":"Richie McCaw 2011.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: New Zealand","url":"https://commons.wikimedia.org/wiki/Category:New_Zealand"},{"label":"Facts","detail":"Wikipedia — New Zealand","url":"https://en.wikipedia.org/wiki/New_Zealand"},{"label":"Travel film","detail":"New Zealand VLOG — Taylor Bell","url":"https://www.youtube.com/watch?v=nqmrFegVTEA"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — New Zealand","url":"https://www.google.com/maps/place/New+Zealand/@-41.2865,174.7762,5z"}]},
  PK: {"tagline":"پاکستان · Peaks, Mosques & Mughal Splendor","photos":[{"f":"Badshahi Masjid - Landscape View.jpg","cap":"Badshahi Mosque, Lahore"},{"f":"K2, Mount Godwin Austen, Chogori, Savage Mountain.jpg","cap":"K2, world's second-highest peak"},{"f":"Hunza Valley, view from Eagle's Nest.jpg","cap":"Hunza Valley from Eagle's Nest"},{"f":"Attabad Lake, Karakoram Highway.jpg","cap":"Attabad Lake, Karakoram Highway"},{"f":"Faisal Mosque in Islamabad.jpg","cap":"Faisal Mosque, Islamabad"},{"f":"Lahore Fort from distance.jpg","cap":"Lahore Fort (Shahi Qila)"},{"f":"Beautiful Architecture of Wazir Khan Mosque, Lahore..jpg","cap":"Wazir Khan Mosque, Lahore"},{"f":"Passu Cones Hunza Valley.jpg","cap":"Passu Cones, Gojal Hunza"},{"f":"Shah Jahan Mosque columns, Thatta.jpg","cap":"Shah Jahan Mosque, Thatta"},{"f":"Amazing Hunza Valley and Hunza River.jpg","cap":"Hunza River and Valley"}],"video":{"id":"K3cqEuE63s8","title":"What it's like exploring HUNZA, PAKISTAN as a solo female traveler","by":"Flora Gonning"},"cities":[{"name":"Islamabad","lng":73.0479,"lat":33.6844,"capital":true},{"name":"Karachi","lng":67.0011,"lat":24.8607},{"name":"Lahore","lng":74.3587,"lat":31.5204},{"name":"Faisalabad","lng":73.0776,"lat":31.4181},{"name":"Peshawar","lng":71.5249,"lat":34.0151},{"name":"Quetta","lng":66.975,"lat":30.1798},{"name":"Multan","lng":71.5249,"lat":30.1575},{"name":"Gilgit","lng":74.3089,"lat":35.9208}],"maps":"https://www.google.com/maps/place/Pakistan/@30.3753,69.3451,5z","facts":{"capital":"Islamabad","population":"≈ 241 million (2024)","languages":"Urdu (national), English (official)","langCount":"2 official / 70+ spoken","independence":"14 August 1947 (from British India)","government":"Federal parliamentary republic","etymology":"Coined in 1933 as an acronym for Punjab, Afghania, Kashmir, Sindh and Baluchistan, it also means <em>Land of the Pure</em> in Persian and Urdu."},"people":[{"n":"Muhammad Ali Jinnah","r":"Founding father, first Governor-General","img":""},{"n":"Malala Yousafzai","r":"Nobel-laureate education activist","img":""},{"n":"Abdus Salam","r":"Nobel-winning theoretical physicist","img":""},{"n":"Benazir Bhutto","r":"First woman PM of Pakistan","img":""},{"n":"Arfa Karim","r":"Youngest Microsoft Certified Professional","img":""}],"music":{"n":"Nusrat Fateh Ali Khan","r":"Qawwali legend, Shahenshah-e-Qawwali","img":"Nusrat Fateh Ali Khan.jpg"},"art":{"n":"Sadequain","r":"Painter and calligrapher","img":""},"writer":{"n":"Allama Muhammad Iqbal","r":"National poet-philosopher","img":"Allama Iqbal.jpg"},"stage":{"n":"Mahira Khan","r":"Leading film and TV actress","img":"Mahira Khan.jpg"},"sports":{"n":"Jahangir Khan","r":"Ten-time squash world champion","img":"Jahangir Khan-2010-20-09.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Pakistan category","url":"https://commons.wikimedia.org/wiki/Category:Pakistan"},{"label":"Facts","detail":"Wikipedia — Pakistan","url":"https://en.wikipedia.org/wiki/Pakistan"},{"label":"Travel film","detail":"Flora Gonning on YouTube","url":"https://www.youtube.com/watch?v=K3cqEuE63s8"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Pakistan","url":"https://www.google.com/maps/place/Pakistan/@30.3753,69.3451,5z"}]},
  NO: {"tagline":"Norge · Fjords, aurora, midnight sun","photos":[{"f":"Fiordo de Geiranger desde Flydalsjuvet, Noruega, 2019-09-07, DD 61.jpg","cap":"Geirangerfjord from Flydalsjuvet"},{"f":"Naerøyfjorden.jpg","cap":"Nærøyfjord, a UNESCO-listed fjord"},{"f":"Preikestolen Norge.jpg","cap":"Preikestolen above Lysefjord"},{"f":"Panorama of Lysefjord.jpg","cap":"Lysefjord from Pulpit Rock"},{"f":"Trolltunga.jpg","cap":"Trolltunga ledge over Ringedalsvatnet"},{"f":"Sakrisøy village and mountains Lofoten Norway.jpg","cap":"Sakrisøy, Lofoten Islands"},{"f":"Moskenes Reinebringen lub 2025-07-21 img09 Aussicht.jpg","cap":"Reinebringen view, Lofoten"},{"f":"Nancy Porcino - Northern lights at Lofoten.jpg","cap":"Aurora over Lofoten"},{"f":"Bergen Bryggen.jpg","cap":"Bryggen Hanseatic wharf, Bergen"},{"f":"Oslo Opera House 2023 3.jpg","cap":"Oslo Opera House, Bjørvika"}],"video":{"id":"QQS1X7Z55_E","title":"7 Day NORWAY Road Trip: The Lofoten Islands (Best Itinerary!)","by":"Kristina's Travels"},"cities":[{"name":"Oslo","lng":10.7522,"lat":59.9139,"capital":true},{"name":"Bergen","lng":5.3221,"lat":60.3913},{"name":"Trondheim","lng":10.3951,"lat":63.4305},{"name":"Stavanger","lng":5.7331,"lat":58.97},{"name":"Tromsø","lng":18.9553,"lat":69.6492},{"name":"Drammen","lng":10.2045,"lat":59.744},{"name":"Kristiansand","lng":7.9956,"lat":58.1467},{"name":"Ålesund","lng":6.1495,"lat":62.4722}],"maps":"https://www.google.com/maps/place/Norway/@64.5731,11.5280,5z","facts":{"capital":"Oslo","population":"≈ 5.5 million (2024)","languages":"Norwegian (Bokmål, Nynorsk), Sámi","langCount":"2 official / 10+ spoken","independence":"1905 (union with Sweden dissolved)","government":"Unitary parliamentary constitutional monarchy","etymology":"The name likely derives from Old Norse <em>norðrvegr</em>, meaning 'the northern way' along the coast."},"people":[{"n":"Fridtjof Nansen","r":"Polar explorer, Nobel laureate","img":"Fridtjof_Nansen_LOC_03377u-3.jpg"},{"n":"Roald Amundsen","r":"First to reach South Pole","img":"Amundsen in fur skins.jpg"},{"n":"Jens Stoltenberg","r":"Ex-PM, NATO Secretary General","img":"Jens_Stoltenberg,_Minister_of_Finance_of_Norway,_at_the_Munich_Security_Conference_in_Munich,_Germany_on_February_14,_2025_(cropped).jpg"},{"n":"Gro Harlem Brundtland","r":"First female Prime Minister","img":"Gro_Harlem_Brundtland_in_2025_(cropped).jpg"},{"n":"Thor Heyerdahl","r":"Kon-Tiki voyager, adventurer","img":"Thor Heyerdahl.jpg"}],"music":{"n":"Edvard Grieg","r":"Romantic-era composer","img":"Edward Greig LCCN2016872661.jpg"},"art":{"n":"Edvard Munch","r":"Painter of The Scream","img":"Edvard Munch 1933-2.jpg"},"writer":{"n":"Henrik Ibsen","r":"Playwright, father of modern drama","img":"Henrik Ibsen 1887.jpg"},"stage":{"n":"Liv Ullmann","r":"Acclaimed film actress and director","img":"Liv Ullmann.jpg"},"sports":{"n":"Magnus Carlsen","r":"World chess champion","img":"Magnus Carlsen in 2025.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category:Norway","url":"https://commons.wikimedia.org/wiki/Category:Norway"},{"label":"Facts","detail":"Wikipedia — Norway","url":"https://en.wikipedia.org/wiki/Norway"},{"label":"Travel film","detail":"Kristina's Travels — 7 Day Norway Road Trip","url":"https://www.youtube.com/watch?v=QQS1X7Z55_E"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Norway","url":"https://www.google.com/maps/place/Norway/@64.5731,11.5280,5z"}]},
  FI: {"tagline":"Suomi · Land of a Thousand Lakes","photos":[{"f":"Senaatintori_(Helsinki_Senate_Square)_elokuussa_2018_02.jpg","cap":"Helsinki Cathedral over Senate Square"},{"f":"Suomen_Ilmakuva_-_Aerial_photograph_from_the_center_of_Helsinki_to_the_sea_in_2015.jpg","cap":"Helsinki waterfront from above"},{"f":"Panorama view to Lake Pielinen at Koli National Park.jpg","cap":"Koli heights over Lake Pielinen"},{"f":"Koli, Autiovaara ja Pieni Honkavaara.jpg","cap":"Lakeland ridges at Koli"},{"f":"Northern Lights - Sirkka, Kittilä (46211740125).jpg","cap":"Aurora over Lapland"},{"f":"Suomenlinna_from_northeast.JPG","cap":"Suomenlinna sea fortress"},{"f":"Suomenlinna_mereltä_1.jpg","cap":"Suomenlinna from the water"},{"f":"Old_Porvoo_riverside.jpg","cap":"Red shore houses of Old Porvoo"},{"f":"Nuuksio_lake_2.jpg","cap":"Forest lake in Nuuksio"},{"f":"Vanha_Porvoo._View_from_Porvoon_vanha_silta.jpg","cap":"Porvoo old town riverside"}],"video":{"id":"MXH_sMUUP3Y","title":"Helsinki: The Quiet Capital of the World's Happiest Country","by":"A Sense of Travel with Michael Matheny"},"cities":[{"name":"Helsinki","lng":24.9384,"lat":60.1699,"capital":true},{"name":"Espoo","lng":24.6559,"lat":60.2055},{"name":"Tampere","lng":23.761,"lat":61.4978},{"name":"Turku","lng":22.2666,"lat":60.4518},{"name":"Oulu","lng":25.4651,"lat":65.0121},{"name":"Rovaniemi","lng":25.7294,"lat":66.5039},{"name":"Porvoo","lng":25.6612,"lat":60.3923}],"maps":"https://www.google.com/maps/place/Finland/@64.9631,25.7482,5z","facts":{"capital":"Helsinki","population":"≈ 5.6 million (2024)","languages":"Finnish, Swedish","langCount":"2 official / 150+ spoken","independence":"6 December 1917 (from Russia)","government":"Unitary parliamentary republic","etymology":"\"Suomi\" is of uncertain origin, possibly sharing a root with <em>Sámi</em>, while \"Finland\" first named the coastal region around Turku before it came to mean the whole nation."},"people":[{"n":"Jean Sibelius","r":"Composer","img":"Jean_Sibelius_in_1890_(cropped).jpg"},{"n":"Tove Jansson","r":"Writer, Moomins creator","img":"Tove_Jansson_by_Eemu_Myntti.jpg"},{"n":"Akseli Gallen-Kallela","r":"National Romantic painter","img":"Akseli_Gallen-Kallela_01.jpg"},{"n":"Kimi Räikkönen","r":"Formula 1 world champion","img":"Kimi_raikkonen_(52780844274)_(cropped).jpg"},{"n":"Linus Torvalds","r":"Creator of Linux","img":""}],"music":{"n":"Jean Sibelius","r":"Composer","img":"Jean_Sibelius_in_1890_(cropped).jpg"},"art":{"n":"Akseli Gallen-Kallela","r":"National Romantic painter","img":"Akseli_Gallen-Kallela_01.jpg"},"writer":{"n":"Tove Jansson","r":"Writer, Moomins creator","img":"Tove_Jansson_by_Eemu_Myntti.jpg"},"stage":{"n":"Peter Franzén","r":"Actor","img":"Peter Franzén.jpg"},"sports":{"n":"Kimi Räikkönen","r":"Formula 1 world champion","img":"Kimi_raikkonen_(52780844274)_(cropped).jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: Finland","url":"https://commons.wikimedia.org/wiki/Category:Finland"},{"label":"Facts","detail":"Wikipedia — Finland","url":"https://en.wikipedia.org/wiki/Finland"},{"label":"Travel film","detail":"A Sense of Travel with Michael Matheny (YouTube)","url":"https://www.youtube.com/watch?v=MXH_sMUUP3Y"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Finland","url":"https://www.google.com/maps/place/Finland/@64.9631,25.7482,5z"}]},
  DK: {"tagline":"Danmark · Hygge, harbors and hand-built LEGO","photos":[{"f":"Nyhavn Copenhagen 2.jpg","cap":"Nyhavn's painted harbor houses, Copenhagen"},{"f":"2018 - Nyhavn on sunset.jpg","cap":"Nyhavn canal at sunset"},{"f":"Nyhavn MichaD.jpg","cap":"Waterfront cafés along Nyhavn"},{"f":"Kronborg April 2026 05.jpg","cap":"Kronborg Castle, Hamlet's Elsinore"},{"f":"Frederiksborg Castle.jpg","cap":"Frederiksborg Castle, Hillerød"},{"f":"The Little Mermaid home.jpg","cap":"The Little Mermaid statue, Copenhagen"},{"f":"Mons Klint.jpg","cap":"White chalk cliffs of Møns Klint"},{"f":"Møns Klint - panoramio (1).jpg","cap":"Møns Klint above the Baltic Sea"},{"f":"Aarhus waterfront.jpg","cap":"Aarhus harborfront skyline"},{"f":"Legoland Billund - Indgangen 01.jpg","cap":"Legoland entrance, Billund"}],"video":{"id":"RBydZzcSOeo","title":"Exploring COPENHAGEN in 3 Days (2024) [TRAVEL VLOG]","by":"Divya Love"},"cities":[{"name":"Copenhagen","lng":12.5683,"lat":55.6761,"capital":true},{"name":"Aarhus","lng":10.2039,"lat":56.1629},{"name":"Odense","lng":10.4024,"lat":55.4038},{"name":"Aalborg","lng":9.9217,"lat":57.0488},{"name":"Esbjerg","lng":8.452,"lat":55.4761},{"name":"Randers","lng":10.0364,"lat":56.4607},{"name":"Kolding","lng":9.472,"lat":55.4904},{"name":"Helsingør","lng":12.6136,"lat":56.0361}],"maps":"https://www.google.com/maps/place/Denmark/@56.2639,9.5018,7z","facts":{"capital":"Copenhagen","population":"≈ 5.9 million (2024)","languages":"Danish","langCount":"1 official / 5+ spoken","independence":"c. 8th century (unified kingdom, one of Europe's oldest)","government":"Unitary parliamentary constitutional monarchy","etymology":"The name joins <em>Dan</em> (the Danes) with <em>mark</em>, meaning borderland or march."},"people":[{"n":"Hans Christian Andersen","r":"Fairy-tale author","img":"Hans Christian Andersen by Thora Hallager 1869.jpg"},{"n":"Søren Kierkegaard","r":"Philosopher, father of existentialism","img":""},{"n":"Niels Bohr","r":"Nobel physicist","img":""},{"n":"Mads Mikkelsen","r":"Film actor","img":""},{"n":"Carl Nielsen","r":"Composer","img":""}],"music":{"n":"Lukas Graham","r":"Pop band (Lukas Forchhammer)","img":""},"art":{"n":"Vilhelm Hammershøi","r":"Painter of quiet interiors","img":""},"writer":{"n":"Hans Christian Andersen","r":"Fairy-tale author","img":"Hans Christian Andersen by Thora Hallager 1869.jpg"},"stage":{"n":"Mads Mikkelsen","r":"Film and stage actor","img":""},"sports":{"n":"Caroline Wozniacki","r":"Former world No. 1 tennis player","img":""},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: Denmark","url":"https://commons.wikimedia.org/wiki/Category:Denmark"},{"label":"Facts","detail":"Wikipedia — Denmark","url":"https://en.wikipedia.org/wiki/Denmark"},{"label":"Travel film","detail":"Exploring COPENHAGEN in 3 Days (2024) — Divya Love","url":"https://www.youtube.com/watch?v=RBydZzcSOeo"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Denmark","url":"https://www.google.com/maps/place/Denmark/@56.2639,9.5018,7z"}]},
  BD: {"tagline":"বাংলাদেশ · Land of Rivers and Resilience","photos":[{"f":"Bay_of_Sundarbans.jpg","cap":"Sundarbans mangrove delta at dawn"},{"f":"Mangrove_and_river_in_Sundarbans.JPG","cap":"River winding through the Sundarbans"},{"f":"Front_View_of_Sixty_Dome_Mosque.jpg","cap":"Sixty Dome Mosque, Bagerhat"},{"f":"Cox's_Bazar_beach_3.jpg","cap":"Cox's Bazar, world's longest sea beach"},{"f":"Cox's_Bazar_beach_4.jpg","cap":"Waves along the Cox's Bazar coast"},{"f":"Historic_Ahsan_Manzil_Palace_Bangladesh.jpg","cap":"Ahsan Manzil, Dhaka's Pink Palace"},{"f":"Dhaka_cityscape_sunset.jpg","cap":"Dhaka skyline at sunset"},{"f":"The_National_Parliament_of_Bangladesh_01.jpg","cap":"Jatiya Sangsad, National Parliament House"},{"f":"Lalbagh_Fort_02.jpg","cap":"Mughal-era Lalbagh Fort, Dhaka"},{"f":"Star_Mosque_2023.jpg","cap":"Star Mosque (Tara Masjid), Dhaka"}],"video":{"id":"FYakAAomraQ","title":"Dhaka Bangladesh Travel - my experience","by":"Hashem McAdam"},"cities":[{"name":"Dhaka","lng":90.4125,"lat":23.8103,"capital":true},{"name":"Chittagong","lng":91.8123,"lat":22.3569},{"name":"Khulna","lng":89.5403,"lat":22.8456},{"name":"Rajshahi","lng":88.6042,"lat":24.3745},{"name":"Sylhet","lng":91.8687,"lat":24.8949},{"name":"Barisal","lng":90.3535,"lat":22.701},{"name":"Rangpur","lng":89.2752,"lat":25.7439},{"name":"Cox's Bazar","lng":91.9832,"lat":21.4272}],"maps":"https://www.google.com/maps/place/Bangladesh/@23.6850,90.3563,7z","facts":{"capital":"Dhaka","population":"≈ 173 million (2024)","languages":"Bengali (Bangla)","langCount":"1 official / 40+ spoken","independence":"1971 (from Pakistan)","government":"Unitary parliamentary republic","etymology":"The name combines <em>Bangla</em>, the endonym of the Bengali people and their land, with <em>desh</em>, meaning \"country\" — literally \"country of Bengal.\""},"people":[{"n":"Sheikh Mujibur Rahman","r":"Founding father of Bangladesh","img":""},{"n":"Muhammad Yunus","r":"Nobel laureate, microcredit pioneer","img":""},{"n":"Kazi Nazrul Islam","r":"National poet of Bangladesh","img":"Nazrul.jpg"},{"n":"Shakib Al Hasan","r":"World-class cricket all-rounder","img":"Shakib_Al_Hasan_(4)_(cropped).jpg"},{"n":"Runa Laila","r":"Legendary playback singer","img":"Runa_Laila_on_4_July_2017_(01)_(cropped).jpg"}],"music":{"n":"Runa Laila","r":"Playback singer, \"Queen of Melody\"","img":"Runa_Laila_on_4_July_2017_(01)_(cropped).jpg"},"art":{"n":"Zainul Abedin","r":"Painter, \"Shilpacharya\" master artist","img":"Zainul_Abedin.jpg"},"writer":{"n":"Kazi Nazrul Islam","r":"National poet, \"Rebel Poet\"","img":"Nazrul.jpg"},"stage":{"n":"Chanchal Chowdhury","r":"Acclaimed film and TV actor","img":"চঞ্চল চৌধুরী.jpg"},"sports":{"n":"Shakib Al Hasan","r":"Cricket all-rounder and captain","img":"Shakib_Al_Hasan_(4)_(cropped).jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category:Bangladesh","url":"https://commons.wikimedia.org/wiki/Category:Bangladesh"},{"label":"Facts","detail":"Wikipedia — Bangladesh","url":"https://en.wikipedia.org/wiki/Bangladesh"},{"label":"Travel film","detail":"Dhaka Bangladesh Travel — Hashem McAdam","url":"https://www.youtube.com/watch?v=FYakAAomraQ"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Bangladesh","url":"https://www.google.com/maps/place/Bangladesh/@23.6850,90.3563,7z"}]},
  BE: {"tagline":"België · Beer, chocolate & surrealists","photos":[{"f":"Edificios en la Grand-Place, Bruselas, Bélgica, 2021-12-15, DD 12.jpg","cap":"Grand-Place guild houses, Brussels"},{"f":"2018 flower carpet at Grand Place, Brussels (DSCF6849).jpg","cap":"Flower Carpet on the Grand-Place"},{"f":"Brugge (48196318206).jpg","cap":"Canals of medieval Bruges"},{"f":"Brugge (48196318316).jpg","cap":"Bruges waterside rooftops"},{"f":"Belgium-6362 - Graslei (14080420651).jpg","cap":"Graslei quay, Ghent"},{"f":"Belgio - Gand - ponte San Michele, chiesa San Michele e fiume Lys.jpg","cap":"St Michael's Bridge, Ghent"},{"f":"25890 Gravensteen bij zonsondergang vanuit de Sint-Widostraat, Gent.jpg","cap":"Gravensteen castle at sunset"},{"f":"1. Atomium. Laeken-Bruksela 02.jpg","cap":"The Atomium, Brussels"},{"f":"AKIBA - Antwerp-Central - 12-12-2023 1.jpg","cap":"Antwerpen-Centraal station"},{"f":"10 of 10 - Dinant Fortress, Belgium.jpg","cap":"Citadel above the Meuse, Dinant"}],"video":{"id":"g-fmCxT3HNA","title":"BELGIUM VLOG || exploring fairytale cities Brussels, Bruges, & Ghent!","by":"Maddie Tsang"},"cities":[{"name":"Brussels","lng":4.3517,"lat":50.8503,"capital":true},{"name":"Antwerp","lng":4.4025,"lat":51.2194},{"name":"Ghent","lng":3.725,"lat":51.0543},{"name":"Bruges","lng":3.2247,"lat":51.2093},{"name":"Liège","lng":5.5797,"lat":50.6326},{"name":"Charleroi","lng":4.4444,"lat":50.4108},{"name":"Namur","lng":4.872,"lat":50.4674},{"name":"Leuven","lng":4.7005,"lat":50.8798}],"maps":"https://www.google.com/maps/place/Belgium/@50.5039,4.4699,8z","facts":{"capital":"Brussels","population":"≈ 11.7 million (2024)","languages":"Dutch, French, German","langCount":"3 official / 3+ spoken","independence":"1830 (from the Netherlands)","government":"Federal parliamentary constitutional monarchy","etymology":"Named after the <em>Belgae</em>, the ancient Celtic-Germanic tribes Julius Caesar described inhabiting the region."},"people":[{"n":"Stromae","r":"Genre-bending pop singer","img":"Stromae @ BSF 2011 (6070934641).jpg"},{"n":"René Magritte","r":"Surrealist painter","img":"René Magritte in 1961.jpg"},{"n":"Hergé","r":"Tintin cartoonist","img":"Hergé, Premier plan, 1962, Radio-Canada, 1.jpg"},{"n":"Jean-Claude Van Damme","r":"Action-film actor","img":"Jean-Claude Van Damme 2012.jpg"},{"n":"Eddy Merckx","r":"Cycling legend","img":"Eddy Merckx.jpg"}],"music":{"n":"Stromae","r":"Genre-bending pop singer","img":"Stromae @ BSF 2011 (6070934641).jpg"},"art":{"n":"René Magritte","r":"Surrealist painter","img":"René Magritte in 1961.jpg"},"writer":{"n":"Hergé","r":"Tintin cartoonist","img":"Hergé, Premier plan, 1962, Radio-Canada, 1.jpg"},"stage":{"n":"Jean-Claude Van Damme","r":"Action-film actor","img":"Jean-Claude Van Damme 2012.jpg"},"sports":{"n":"Eddy Merckx","r":"Cycling legend","img":"Eddy Merckx.jpg"},"sources":[{"label":"Photos","detail":"Wikimedia Commons — Category: Belgium","url":"https://commons.wikimedia.org/wiki/Category:Belgium"},{"label":"Facts","detail":"Wikipedia — Belgium","url":"https://en.wikipedia.org/wiki/Belgium"},{"label":"Travel film","detail":"Maddie Tsang — Belgium vlog","url":"https://www.youtube.com/watch?v=g-fmCxT3HNA"},{"label":"Map outline","detail":"Natural Earth via world-atlas — public domain","url":"https://www.naturalearthdata.com/"},{"label":"Location","detail":"Google Maps — Belgium","url":"https://www.google.com/maps/place/Belgium/@50.5039,4.4699,8z"}]},
};

const info = document.getElementById("info");
const infoInner = document.getElementById("info-inner");

function openInfo(code){
  const d = COUNTRY_INFO[code]; if (!d) return;
  const c = COUNTRIES[code];
  document.documentElement.style.setProperty("--accent", c.color);

  const slides = [];
  // video slide first (loaded lazily on open via the injected iframe below)
  if (d.video) slides.push(
    `<div class="info-slide info-slide--vid" data-yt="${d.video.id}">
       <div class="info-vid" id="info-vid"></div>
       <div class="info-slide__cap"><span class="info-slide__vtag">▶ TRAVEL FILM</span> ${esc(d.video.title)} · <i>${esc(d.video.by)}</i></div>
     </div>`);
  d.photos.forEach(p => slides.push(
    `<div class="info-slide">
       <img loading="lazy" src="${wmFile(p.f)}" alt="${esc(p.cap)}">
       <div class="info-slide__cap">${esc(p.cap)}</div>
     </div>`));

  if (slides.length > 1 && /info-slide--vid/.test(slides[0])) { const _v = slides.shift(); slides.splice(1, 0, _v); }  // video always 2nd
  const factRow = (label, val) => `<div class="info-fact"><span class="info-fact__k">${label}</span><span class="info-fact__v">${val}</span></div>`;
  const f = d.facts;
  // Wikipedia "Go" search resolves to the exact article (or a redirect) when it exists — lets people dig deeper
  const wikiLink = name => "https://en.wikipedia.org/wiki/Special:Search?go=Go&search=" + encodeURIComponent(name);
  const faceImg = (img, name) => img
    ? `<img class="info-face__img" loading="lazy" src="${wmFace(img)}" alt="${esc(name)}">`
    : `<div class="info-face__img info-face__img--none">${esc((name || "?").trim().slice(0,1))}</div>`;
  const peopleHtml = d.people.map(p => `
    <a class="info-face" href="${wikiLink(p.n)}" target="_blank" rel="noopener" title="${esc(p.n)} — read on Wikipedia">
      ${faceImg(p.img, p.n)}
      <div class="info-face__n">${esc(p.n)} <span class="info-face__ext" aria-hidden="true">↗</span></div>
      <div class="info-face__r">${esc(p.r)}</div>
    </a>`).join("");

  // Single-figure "best known" cards — render only those present so older entries stay valid.
  const STARS = [
    { k: "music",  icon: "🎵", label: "Best-known music artist" },
    { k: "art",    icon: "🎨", label: "Best-known visual artist" },
    { k: "writer", icon: "✍️", label: "Best-known writer" },
    { k: "stage",  icon: "🎭", label: "Best-known performer" },
    { k: "sports", icon: "🏅", label: "Most famous sports figure" },
  ];
  const starCard = s => {
    const v = d[s.k];
    if (!v) return "";
    return `<div class="info-card">
        <h3>${s.icon} ${s.label}</h3>
        <a class="info-starrow" href="${wikiLink(v.n)}" target="_blank" rel="noopener" title="${esc(v.n)} — read on Wikipedia">${faceImg(v.img, v.n)}<div><div class="info-star">${esc(v.n)} <span class="info-face__ext" aria-hidden="true">↗</span></div><div class="info-star__r">${esc(v.r)}</div></div></a>
      </div>`;
  };
  const starsHtml = STARS.map(starCard).join("");

  // Vertical history timeline — rendered only for countries that have `timeline` data (Cuba pilot).
  const timelineHtml = (d.timeline && d.timeline.length) ? `
    <div class="info-timeline">
      <h3>⏳ A short history of ${esc(c.name)}</h3>
      <ol class="tl">
        ${d.timeline.map(e => `
          <li class="tl__row">
            <span class="tl__dot" aria-hidden="true"></span>
            <span class="tl__yr">${esc(e.y)}</span>
            <div class="tl__body">
              <div class="tl__t">${esc(e.t)}</div>
              <div class="tl__d">${esc(e.d)}</div>
            </div>
          </li>`).join("")}
      </ol>
    </div>` : "";

  infoInner.innerHTML = `
    <div class="info-head">
      <div class="jhead__flag">${flagImg(code)}</div>
      <div>
        <h2 class="info-name" style="--accent:${c.color}">${esc(c.name)}</h2>
        ${d.tagline ? `<div class="info-tag">${esc(d.tagline)}</div>` : ""}
      </div>
      ${WC_TITLES[code] ? `<div class="info-wc" title="${WC_TITLES[code]} FIFA World Cup title${WC_TITLES[code] > 1 ? "s" : ""}" aria-label="${WC_TITLES[code]} World Cup title${WC_TITLES[code] > 1 ? "s" : ""} won">${'<span class="info-wc__t">🏆</span>'.repeat(WC_TITLES[code])}<span class="info-wc__b">⚽</span></div>` : ""}
    </div>

    <div class="info-carousel" id="info-carousel">
      <button class="info-arrow info-arrow--l" id="info-prev" aria-label="Previous">‹</button>
      <div class="info-track" id="info-track">${slides.join("")}</div>
      <button class="info-arrow info-arrow--r" id="info-next" aria-label="Next">›</button>
    </div>

    <div class="info-grid">
      <div class="info-mapbox">
        <div class="info-mapmain">
          <svg class="info-map" id="info-map" viewBox="0 0 360 200" role="img" aria-label="Map of ${esc(c.name)} with major cities"></svg>
          <span class="info-map__hint" aria-hidden="true">⤢ scroll · pinch to zoom</span>
        </div>
        <div class="info-insets" id="info-insets"></div>
        <a class="info-maps-link" href="${d.maps}" target="_blank" rel="noopener" title="Open in Google Maps" aria-label="Open in Google Maps"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg></a>
      </div>
      <div class="info-facts">
        ${factRow("Capital", esc(f.capital))}
        ${factRow("Population", esc(f.population))}
        ${factRow("Languages", esc(f.languages) + `<small>${esc(f.langCount)}</small>`)}
        ${factRow("Independence", esc(f.independence))}
        ${factRow("Government", esc(f.government))}
        ${factRow("Name origin", f.etymology)}
      </div>
    </div>

    <div class="info-cards">
      <div class="info-card info-card--wide">
        <h3>Historically important figures</h3>
        <div class="info-faces">${peopleHtml}</div>
      </div>
      ${starsHtml}
    </div>

    ${timelineHtml}

    <div class="info-sources">
      <h3>Data sources</h3>
      <ul>${(d.sources || []).map(s => `<li><a href="${s.url}" target="_blank" rel="noopener"><span class="info-sources__k">${esc(s.label)}</span> ${esc(s.detail)}</a></li>`).join("")}</ul>
    </div>`;

  info.hidden = false;
  document.body.classList.add("info-open");
  infoInner.scrollTop = 0;   // always open a country dossier scrolled to the top

  // lazy-load the YouTube video into its slide (only when the overlay is opened)
  const vslot = document.getElementById("info-vid");
  if (vslot && d.video){
    const ifr = document.createElement("iframe");
    ifr.src = `https://www.youtube-nocookie.com/embed/${d.video.id}?rel=0&modestbranding=1`;
    ifr.title = d.video.title;
    ifr.loading = "lazy";
    ifr.allow = "accelerometer; encrypted-media; gyroscope; picture-in-picture";
    ifr.setAttribute("allowfullscreen", "");
    vslot.appendChild(ifr);
  }

  // carousel arrows (scroll by one slide)
  const track = document.getElementById("info-track");
  const step = () => (track.querySelector(".info-slide") || {}).clientWidth || track.clientWidth;
  document.getElementById("info-prev").onclick = () => track.scrollBy({ left: -step() - 12, behavior: "smooth" });
  document.getElementById("info-next").onclick = () => track.scrollBy({ left:  step() + 12, behavior: "smooth" });

  drawCountryOutline(code, document.getElementById("info-map"));
}

function closeInfo(){
  info.hidden = true;
  document.body.classList.remove("info-open");
  const vslot = document.getElementById("info-vid");
  if (vslot) vslot.innerHTML = "";   // stop the video / free the iframe
}
document.getElementById("info-close").onclick = closeInfo;
document.getElementById("info-scrim").onclick = closeInfo;
document.addEventListener("keydown", e => { if (e.code === "Escape" && !info.hidden){ e.preventDefault(); e.stopPropagation(); closeInfo(); } }, true);

// render a country's outline + a set of city markers into one SVG, fitted to `bounds`
// ([[w,s],[e,n]]) or to the whole feature when bounds is null. Adds drag/scroll/pinch zoom.
function renderMap(svgEl, feat, color, cityList, bounds){
  if (!svgEl) return;
  const vb = svgEl.viewBox.baseVal, W = vb.width || 360, H = vb.height || 200;
  const pad = Math.min(W, H) < 160 ? 8 : 16;
  const proj = d3.geoMercator();
  if (bounds){
    // fit to the box CORNERS as a MultiPoint — a Polygon here hits d3-geo's spherical winding
    // ambiguity (it reads the box as "whole globe minus box" and zooms all the way out)
    const boxFeat = { type:"MultiPoint", coordinates:[
      [bounds[0][0],bounds[0][1]],[bounds[1][0],bounds[0][1]],
      [bounds[1][0],bounds[1][1]],[bounds[0][0],bounds[1][1]] ] };
    proj.fitExtent([[pad,pad],[W-pad,H-pad]], boxFeat);
  } else {
    proj.fitExtent([[pad,pad],[W-pad,H-pad]], feat);
  }
  const gp = d3.geoPath(proj);
  const small = Math.min(W, H) < 160;
  const rDot = small ? 2.4 : 3.2, rStar = small ? 6 : 8, fs = small ? 8 : 9;
  const starPts = (cx, cy, R) => Array.from({length:10}, (_, i) => {
    const rad = i % 2 ? R * 0.42 : R, a = -Math.PI/2 + i * Math.PI/5;
    return `${(cx + rad*Math.cos(a)).toFixed(2)},${(cy + rad*Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  const dots = (cityList || []).map(ci => {
    const p = proj([ci.lng, ci.lat]); if (!p) return "";
    const off = ci.capital ? rStar + 2 : rDot + 4;
    const marker = ci.capital
      ? `<polygon points="${starPts(p[0], p[1], rStar)}" fill="${color}" stroke="#0a0916" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
      : `<circle cx="${p[0]}" cy="${p[1]}" r="${rDot}" fill="#0a0916" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    return `${marker}
      <text x="${p[0] + (p[0] > W*0.72 ? -off : off)}" y="${p[1] + 3}" text-anchor="${p[0] > W*0.72 ? "end" : "start"}"
        fill="#fff7e6" font-family="Space Mono,monospace" font-size="${fs}" font-weight="700"
        style="paint-order:stroke;stroke:#0a0916;stroke-width:2.4px;vector-effect:non-scaling-stroke">${esc(ci.name)}</text>`;
  }).join("");
  // everything lives in a <g> so pan + zoom (drag / scroll / pinch) can transform it
  svgEl.innerHTML = `<g class="info-map__g">` +
    `<path d="${gp(feat)}" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    dots + `</g>`;
  const g = svgEl.querySelector(".info-map__g");
  const mapZoom = d3.zoom().scaleExtent([1, 12])
    .translateExtent([[0, 0], [W, H]]).extent([[0, 0], [W, H]])
    .on("zoom", e => g.setAttribute("transform", e.transform.toString()));
  d3.select(svgEl).call(mapZoom).call(mapZoom.transform, d3.zoomIdentity);
}

/* bounds of the landmass local to a city cluster — vertices within ~28° lng (wrap-aware) / 20° lat of
   the cluster, so an inset shows the WHOLE nearby territory (all of Alaska, all of Hawaii), not just the city */
function localBounds(feat, cities){
  const cx = cities.reduce((a,c)=>a+c.lng,0)/cities.length, cy = cities.reduce((a,c)=>a+c.lat,0)/cities.length;
  const geom = feat.geometry;
  const rings = (geom.type==="MultiPolygon" ? geom.coordinates : [geom.coordinates]).map(poly => poly[0]);   // outer rings
  // wrap-aware bounds of a ring, ignoring vertices >35° from the far city (drops dateline specks like the Aleutians)
  const ringBounds = ring => {
    let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity,cnt=0;
    ring.forEach(pt => { let dl=Math.abs(pt[0]-cx); if(dl>180) dl=360-dl;
      if(dl<35){ cnt++; if(pt[0]<w)w=pt[0]; if(pt[0]>e)e=pt[0]; if(pt[1]<s)s=pt[1]; if(pt[1]>n)n=pt[1]; } });
    return cnt ? [w,s,e,n] : null;
  };
  const inPoly = (px,py,ring) => { let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
      if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside; }
    return inside; };
  const host = rings.find(r => cities.some(c => inPoly(c.lng,c.lat,r)));   // the landmass the far city sits on
  const boxes = [];
  if (host){
    const hb = ringBounds(host);
    rings.forEach(r => { const b=ringBounds(r); if(!b) return;
      // keep the host + neighbours within 3° (e.g. the rest of the Hawaiian chain); drop the far mainland
      if(r===host || (b[0]<hb[2]+3 && b[2]>hb[0]-3 && b[1]<hb[3]+3 && b[3]>hb[1]-3)) boxes.push(b); });
  } else {
    rings.forEach(r => { const b=ringBounds(r); if(b){ let dl=Math.abs((b[0]+b[2])/2 - cx); if(dl>180)dl=360-dl; if(dl<15) boxes.push(b); } });
  }
  let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
  boxes.forEach(b=>{ if(b[0]<w)w=b[0]; if(b[1]<s)s=b[1]; if(b[2]>e)e=b[2]; if(b[3]>n)n=b[3]; });
  cities.forEach(c=>{ if(c.lng<w)w=c.lng; if(c.lng>e)e=c.lng; if(c.lat<s)s=c.lat; if(c.lat>n)n=c.lat; });
  if(!isFinite(w)){ const p=3; return [[cx-p,cy-p],[cx+p,cy+p]]; }
  const pad = Math.max(e-w, n-s, 2)*0.06 + 0.5;
  return [[w-pad, s-pad], [e+pad, n+pad]];
}

/* draw a country: main map fitted to the MAINLAND (ignoring far territories), with far islands/
   territories that have cities rendered as their own zoomable inset boxes (e.g. Alaska + Hawaii for US). */
function drawCountryOutline(code, svgEl){
  if (!svgEl) return;
  const insetWrap = document.getElementById("info-insets");
  if (insetWrap) insetWrap.innerHTML = "";
  const iso = COUNTRIES[code] && +COUNTRIES[code].iso;
  const feat = features.find(f => +f.id === iso);
  if (!feat){ svgEl.innerHTML = `<text x="180" y="104" text-anchor="middle" fill="#8a83b8" font-family="Space Mono,monospace" font-size="11">map loading…</text>`; return; }
  const color = COUNTRIES[code].color;
  const cities = (COUNTRY_INFO[code] && COUNTRY_INFO[code].cities) || [];

  // split into polygons; the mainland = the largest polygon plus any polygons near it
  const geom = feat.geometry;
  const polys = geom.type === "MultiPolygon" ? geom.coordinates.map(c => ({ type:"Polygon", coordinates:c })) : [geom];
  const parts = polys.map(g => { const f = { type:"Feature", geometry:g }; return { area: d3.geoArea(f), b: d3.geoBounds(f), c: d3.geoCentroid(f) }; })
    .sort((a,b) => b.area - a.area);
  const big = parts[0];
  const bigSpan = Math.max(big.b[1][0]-big.b[0][0], big.b[1][1]-big.b[0][1]) || 1;
  const bigCtr = [(big.b[0][0]+big.b[1][0])/2, (big.b[0][1]+big.b[1][1])/2];
  const mb = [[big.b[0][0], big.b[0][1]], [big.b[1][0], big.b[1][1]]];   // main-map extent (grows to include nearby land)
  parts.forEach(p => {
    if (p === big) return;
    if (Math.hypot(p.c[0]-bigCtr[0], p.c[1]-bigCtr[1]) < Math.max(bigSpan * 0.85, 12)){   // near mainland → part of the main map (absolute cap so big countries don't swallow far territories like Alaska)
      mb[0][0] = Math.min(mb[0][0], p.b[0][0]); mb[0][1] = Math.min(mb[0][1], p.b[0][1]);
      mb[1][0] = Math.max(mb[1][0], p.b[1][0]); mb[1][1] = Math.max(mb[1][1], p.b[1][1]);
    }
  });
  const mx = (mb[1][0]-mb[0][0])*0.08 + 0.6, my = (mb[1][1]-mb[0][1])*0.08 + 0.6;
  const inMain = ci => ci.lng >= mb[0][0]-mx && ci.lng <= mb[1][0]+mx && ci.lat >= mb[0][1]-my && ci.lat <= mb[1][1]+my;
  const mainCities = cities.filter(inMain), farCities = cities.filter(ci => !inMain(ci));

  // sprawling archipelagos (Indonesia, Philippines) have many "far" cities and no single mainland —
  // fit the whole city set (zoom/pan handles it) instead of spawning a pile of insets.
  if (farCities.length > 3){
    const lngs = cities.map(c => c.lng), lats = cities.map(c => c.lat), p = 2;
    renderMap(svgEl, feat, color, cities, [[Math.min(...lngs)-p, Math.min(...lats)-p], [Math.max(...lngs)+p, Math.max(...lats)+p]]);
    return;
  }

  renderMap(svgEl, feat, color, mainCities, mb);

  // far cities → cluster within ~8° → one zoomable inset box each (Alaska, Hawaii, …)
  if (insetWrap && farCities.length){
    const clusters = [];
    farCities.forEach(ci => {
      const cl = clusters.find(k => k.some(c => Math.hypot(c.lng-ci.lng, c.lat-ci.lat) < 8));
      if (cl) cl.push(ci); else clusters.push([ci]);
    });
    clusters.forEach(cl => {
      const ib = localBounds(feat, cl);   // fit to the WHOLE nearby landmass (all of Alaska / Hawaii), not just the city
      const box = document.createElement("div");
      box.className = "info-inset";
      box.innerHTML = `<svg viewBox="0 0 150 112" role="img" aria-label="${esc(cl[0].name)} inset map"></svg>`;
      insetWrap.appendChild(box);
      renderMap(box.querySelector("svg"), feat, color, cl, ib);
    });
  }
}

// deep link: ?m=<id> opens a shared mixtape (works signed-out — mixes are public-read)
(function(){
  const mid = new URLSearchParams(location.search).get("m");
  if (!mid) return;
  const go = () => { try { loadSharedMix(mid); } catch(e){ console.warn("shared mix", e); } history.replaceState(null, "", location.pathname); };
  if (window.firebase && firebase.apps && firebase.apps.length) setTimeout(go, 300);
  else setTimeout(go, 1000);
})();
