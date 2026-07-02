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

  // full-page redirect (popups get blocked by Chrome/Safari third-party-cookie partitioning)
  window.signInGoogle = () => {
    flashToast("redirecting to Google…");
    auth.signInWithRedirect(new FB.auth.GoogleAuthProvider())
      .catch(e => { console.warn("sign-in", e); flashToast("sign-in error: " + (e.code || "failed")); });
  };
  window.signOutUser = () => auth.signOut();
  // success is handled by onAuthStateChanged; this only surfaces errors from the redirect return
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
    <div class="fav-ctrls" id="fav-ctrls"></div>
    <div class="fav-filters" id="fav-filters"></div>
    <div id="tracklist"></div>`;
  wireAccountButtons();
  setShuf("__favs");   // shuffle pre-filtered to favorites
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
        <div class="track__title">${esc(t.title)}${(!t.ytId)?'<span class="track__30s" title="Preview only — full song not available; 30-second clip">30s</span>':''}</div>
        <div class="track__artist">${esc(t.artist)}${t.diaspora?'<span class="track__nf">diáspora</span>':''}</div>
      </div>
      <span class="track__ct" data-i="${i}" title="times hearted" hidden></span>
      <button class="track__fav${isFav(t.trackId)?" on":""}" data-i="${i}" data-id="${t.trackId}" aria-label="Save to favorites">♥</button>
      <button class="track__play" aria-label="Play">▶</button>
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
  "Creole Caribbean": ["JM","TT","BB","HT","CW","SR"],
  "The Andes": ["PE","BO","EC"],
  "Southern Cone": ["AR","UY","CL","PY"],
  "Lusophone Atlantic": ["PT","BR","AO","CV","MZ"],
  "British Isles": ["GB","IE"],
  "Nordic": ["SE","NO","DK","FI","IS"],
  "Western Europe": ["FR","DE","AT","CH","NL","BE"],
  "Iberia & Mediterranean": ["ES","IT","GR"],
  "The Balkans": ["RS","BA","HR","SI","BG","RO"],
  "Eastern Europe & Baltics": ["PL","CZ","SK","HU","UA","BY","RU","MD","LT","LV","EE"],
  "Maghreb": ["DZ","MA","TN","LY"],
  "Levant & Eastern Mediterranean": ["EG","LB","SY","JO","PS","IQ","IL"],
  "Arabian Gulf": ["SA","KW","AE","QA","OM"],
  "West Africa": ["NG","GH","SN","ML","GN","CI","BJ","NE"],
  "Central Africa": ["CD","CM"],
  "East Africa": ["KE","TZ","UG"],
  "Horn of Africa": ["ET","SO"],
  "Southern Africa": ["ZA","ZW","ZM","MG"],
  "Anatolia & Caucasus": ["TR","AM","AZ","GE"],
  "Persia & the Steppe": ["IR","UZ","KZ","MN"],
  "South Asia": ["IN","PK","BD","NP","LK"],
  "Southeast Asia": ["ID","MY","PH","TH","VN","KH","MM"],
  "East Asia": ["CN","TW","JP","KR"],
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
  if (shuf.country === "__favs") parts.push("favorites");
  else if (shuf.country) parts.push(COUNTRIES[shuf.country].name);
  else if (shuf.region) parts.push(shuf.region);
  if (shuf.era) parts.push((ERAS.find(e => e[0] === shuf.era) || [])[1]);
  if (shuf.genre) parts.push(cap(shuf.genre));
  document.getElementById("shuffle-scope").textContent = parts.length ? parts.join(" · ") : "the world";
  document.getElementById("shuffle-filt").classList.toggle("on", parts.length > 0);
}

// pre-filter the shuffle scope to what's on screen (country / favorites / world) — resets other facets
function setShuf(country){
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
  if (shuf.country === "__favs"){
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
  const scoped = !!shuf.country;   // a country or favorites is selected → stay put
  if (scoped && panel.classList.contains("show") && inner.querySelector("#tracklist")){
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
  const soon = [...new Set(features
    .filter(f => +f.id !== 10 && !isoToCode[+f.id] && f.properties && f.properties.name)
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
    music:  { n: "Celia Cruz",       r: "the “Queen of Salsa” — ¡Azúcar!", img: "Celia_Cruz_1957_color.jpg" },
    sports: { n: "Teófilo Stevenson", r: "3× Olympic heavyweight boxing champion (1972·76·80)", img: "Bundesarchiv_Bild_183-1985-1004-023,_Teofilo_Stevenson_cropped.jpg" },
    sources: [
      { label: "Photos",            detail: "Wikimedia Commons — CC-licensed, individual contributors", url: "https://commons.wikimedia.org/wiki/Category:Cuba" },
      { label: "Facts & figures",   detail: "Wikipedia — “Cuba” & related articles",                    url: "https://en.wikipedia.org/wiki/Cuba" },
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
    music: { n: "Ravi Shankar", r: "sitar maestro who brought Indian music to the world", img: "Ravi_Shankar.jpg" },
    sports: { n: "Sachin Tendulkar", r: "the \"Little Master\" — cricket's greatest run-scorer", img: "The_cricket_legend_Sachin_Tendulkar_at_the_Oval_Maidan_in_Mumbai_During_the_Duke_and_Duchess_of_Cambridge_Visit(26271019082).jpg" },
    sources: [ {label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:India"}, {label:"Facts & figures",detail:"Wikipedia — \"India\" & related articles",url:"https://en.wikipedia.org/wiki/India"}, {label:"Travel film",detail:"YouTube — \"Top 10 Places to Visit in India\" · Stef Hoffer",url:"https://www.youtube.com/watch?v=HWGzQlrJOqM"}, {label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"}, {label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/India/@22.35,78.9,5z"} ],
  },
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
  const faceImg = (img, name) => img
    ? `<img class="info-face__img" loading="lazy" src="${wmFace(img)}" alt="${esc(name)}">`
    : `<div class="info-face__img info-face__img--none">${esc((name || "?").trim().slice(0,1))}</div>`;
  const peopleHtml = d.people.map(p => `
    <div class="info-face">
      ${faceImg(p.img, p.n)}
      <div class="info-face__n">${esc(p.n)}</div>
      <div class="info-face__r">${esc(p.r)}</div>
    </div>`).join("");

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
        <svg class="info-map" id="info-map" viewBox="0 0 360 200" role="img" aria-label="Map of ${esc(c.name)} with major cities"></svg>
        <div class="info-insets" id="info-insets"></div>
        <span class="info-map__hint" aria-hidden="true">⤢ scroll · pinch to zoom</span>
        <a class="info-maps-link" href="${d.maps}" target="_blank" rel="noopener">📍 Open in Google Maps</a>
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
      <div class="info-card">
        <h3>🎵 Best-known music artist</h3>
        <div class="info-starrow">${faceImg(d.music.img, d.music.n)}<div><div class="info-star">${esc(d.music.n)}</div><div class="info-star__r">${esc(d.music.r)}</div></div></div>
      </div>
      <div class="info-card">
        <h3>🏅 Most famous sports figure</h3>
        <div class="info-starrow">${faceImg(d.sports.img, d.sports.n)}<div><div class="info-star">${esc(d.sports.n)}</div><div class="info-star__r">${esc(d.sports.r)}</div></div></div>
      </div>
    </div>

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
    if (Math.hypot(p.c[0]-bigCtr[0], p.c[1]-bigCtr[1]) < bigSpan * 2.2){   // near mainland → part of the main map
      mb[0][0] = Math.min(mb[0][0], p.b[0][0]); mb[0][1] = Math.min(mb[0][1], p.b[0][1]);
      mb[1][0] = Math.max(mb[1][0], p.b[1][0]); mb[1][1] = Math.max(mb[1][1], p.b[1][1]);
    }
  });
  const mx = (mb[1][0]-mb[0][0])*0.08 + 0.6, my = (mb[1][1]-mb[0][1])*0.08 + 0.6;
  const inMain = ci => ci.lng >= mb[0][0]-mx && ci.lng <= mb[1][0]+mx && ci.lat >= mb[0][1]-my && ci.lat <= mb[1][1]+my;
  const mainCities = cities.filter(inMain), farCities = cities.filter(ci => !inMain(ci));

  renderMap(svgEl, feat, color, mainCities, mb);

  // far cities → cluster within ~8° → one zoomable inset box each (Alaska, Hawaii, …)
  if (insetWrap && farCities.length){
    const clusters = [];
    farCities.forEach(ci => {
      const cl = clusters.find(k => k.some(c => Math.hypot(c.lng-ci.lng, c.lat-ci.lat) < 8));
      if (cl) cl.push(ci); else clusters.push([ci]);
    });
    clusters.forEach(cl => {
      const lngs = cl.map(c=>c.lng), lats = cl.map(c=>c.lat);
      let ib = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
      const ipad = Math.max(ib[1][0]-ib[0][0], ib[1][1]-ib[0][1], 2) * 0.7 + 1.5;
      ib = [[ib[0][0]-ipad, ib[0][1]-ipad], [ib[1][0]+ipad, ib[1][1]+ipad]];
      const box = document.createElement("div");
      box.className = "info-inset";
      box.innerHTML = `<svg viewBox="0 0 150 112" role="img" aria-label="${esc(cl[0].name)} inset map"></svg>`;
      insetWrap.appendChild(box);
      renderMap(box.querySelector("svg"), feat, color, cl, ib);
    });
  }
}
