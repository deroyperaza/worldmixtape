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
  MX: { tagline:"Corazón de las Américas · where ancient empires meet endless coastlines",
   photos:[{f:"Zócalo,_Ciudad_de_México_(32846556446)_(cropped).jpg",cap:"The Zócalo · Mexico City"},{f:"Angel_de_la_independencia170409.jpg",cap:"Ángel de la Independencia · Mexico City"},{f:"Teotihuacán-5973.JPG",cap:"Pyramids of Teotihuacán"},{f:"Chichen_Itza_3.jpg",cap:"El Castillo · Chichén Itzá"},{f:"Panorámica_Guadalajara_desde_edificio_Bansi_hacia_norte_(cropped).jpg",cap:"Guadalajara skyline · Jalisco"},{f:"MonteAlbanWest.jpg",cap:"Monte Albán above Oaxaca"},{f:"San_Miguel_de_Allende_Collage.jpg",cap:"San Miguel de Allende · Guanajuato"},{f:"Tulum_2.jpg",cap:"Maya ruins over the sea · Tulum"},{f:"Collage_Cabo_San_Lucas.jpg",cap:"El Arco · Cabo San Lucas"},{f:"Barranca_del_cobre_2.jpg",cap:"Copper Canyon · Chihuahua"}],
   video:{id:"nq5JangW7hE",title:"Top 10 Best Places to Visit in Mexico - Travel Video 2025",by:"Travel Insights"},
   cities:[{name:"Mexico City",lng:-99.13,lat:19.43,capital:true},{name:"Guadalajara",lng:-103.35,lat:20.67},{name:"Monterrey",lng:-100.32,lat:25.69},{name:"Puebla",lng:-98.21,lat:19.04},{name:"Tijuana",lng:-117.04,lat:32.51},{name:"Cancún",lng:-86.85,lat:21.16},{name:"Mérida",lng:-89.62,lat:20.97},{name:"Oaxaca",lng:-96.72,lat:17.06}],
   maps:"https://www.google.com/maps/place/Mexico/@23.6,-102.5,5z",
   facts:{capital:"Mexico City (Ciudad de México)",population:"≈ 129 million (2024)",languages:"Spanish (de facto official) · 68 Indigenous language groups recognized",langCount:"≈ 290+ languages spoken in total",independence:"Sept 16, 1810 declared — Sept 27, 1821 from Spain",government:"Federal presidential constitutional republic",etymology:"From <em>Mēxihco</em> — the Aztec (<em>Mexica</em>) heartland in the Nahuatl language."},
   people:[{n:"Benito Juárez",r:"reforming president — \"respect for others' rights is peace\"",img:"Photograph_of_Benito_Juarez.jpg"},{n:"Miguel Hidalgo",r:"priest who launched the War of Independence",img:"Generalísimo_Miguel_Hidalgo_y_Costilla.png"},{n:"Emiliano Zapata",r:"revolutionary hero — \"land and liberty\"",img:"Emiliano_Zapata4.jpg"},{n:"Frida Kahlo",r:"painter — icon of art, pain & identity",img:"Frida_Kahlo,_by_Guillermo_Kahlo.jpg"},{n:"Sor Juana Inés de la Cruz",r:"colonial poet & pioneer of women's thought",img:"Sor_Juana_by_Miguel_Cabrera.png"}],
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
   music:{n:"Carlos Gardel",r:"the immortal voice of tango",img:"Carlos_gardel_en_su_casa_1933.jpg"},
   sports:{n:"Diego Maradona",r:"football legend — 1986 World Cup champion",img:"Argentina_celebrando_copa_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Argentina"},{label:"Facts & figures",detail:"Wikipedia — \"Argentina\" & related articles",url:"https://en.wikipedia.org/wiki/Argentina"},{label:"Travel film",detail:"YouTube — \"Top 10 Places To Visit in Argentina - Travel Guide\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=OnrJkX4LDBs"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Argentina/@-38,-63,4z"}] },
  ES: { tagline:"España · flamenco fire, Moorish stone & Mediterranean sun",
   photos:[{f:"SF_maig_2_cropped.jpg",cap:"Sagrada Família · Barcelona"},{f:"Dawn_Charles_V_Palace_Alhambra_Granada_Andalusia_Spain.jpg",cap:"The Alhambra · Granada"},{f:"Madrid_Plaza_Mayor_(48733706273).jpg",cap:"Plaza Mayor · Madrid"},{f:"Plaza_de_España_(Sevilla)_-_01.jpg",cap:"Plaza de España · Seville"},{f:"Parc_guell_-_panoramio.jpg",cap:"Park Güell · Barcelona"},{f:"Toledo_(37737041515).jpg",cap:"Toledo · the city of three cultures"},{f:"San_Sebastián_-_Ayuntamiento_10.jpg",cap:"San Sebastián · the Basque coast"},{f:"2002_wurde_das_Ozeaneum_in_Valencia_eröffnet._14.jpg",cap:"City of Arts & Sciences · Valencia"},{f:"Ronda_aerial.jpg",cap:"Ronda · the cliff-top town"},{f:"Picu_Urriellu.jpg",cap:"Picos de Europa · the northern peaks"}],
   video:{id:"IaaFExw8Zt4",title:"SPAIN - Timeless Charms｜Cinematic Travel Video",by:"Marko Gruntar"},
   cities:[{name:"Madrid",lng:-3.70,lat:40.42,capital:true},{name:"Barcelona",lng:2.17,lat:41.39},{name:"Valencia",lng:-0.38,lat:39.47},{name:"Seville",lng:-5.98,lat:37.39},{name:"Zaragoza",lng:-0.89,lat:41.65},{name:"Málaga",lng:-4.42,lat:36.72},{name:"Bilbao",lng:-2.93,lat:43.26},{name:"Granada",lng:-3.60,lat:37.18}],
   maps:"https://www.google.com/maps/place/Spain/@40.0,-3.7,5z",
   facts:{capital:"Madrid",population:"≈ 48.9 million (2024)",languages:"Spanish/Castilian (official); co-official Catalan, Galician, Basque & Valencian",langCount:"≈ 15 languages spoken in total",independence:"Unified 1479 under the Catholic Monarchs — modern democracy since the 1978 Constitution",government:"Unitary parliamentary constitutional monarchy",etymology:"From <em>Hispania</em>, the Roman name for the peninsula — perhaps from Punic <em>ʾî-šapan</em>."},
   people:[{n:"Isabella I of Castile",r:"queen who unified Spain & funded 1492",img:"IsabellaofCastile03.jpg"},{n:"Miguel de Cervantes",r:"author of Don Quixote — father of the modern novel",img:"Cervantes_Jáuregui.jpg"},{n:"Francisco Goya",r:"revolutionary painter of court & war",img:"Vicente_López_Portaña_-_el_pintor_Francisco_de_Goya.jpg"},{n:"Pablo Picasso",r:"co-founder of Cubism — 20th-century titan",img:"Pablo_picasso_1.jpg"},{n:"Salvador Dalí",r:"surrealism's melting-clock showman",img:"Salvador_Dalí_1939.jpg"}],
   music:{n:"Paco de Lucía",r:"the flamenco guitarist who took it worldwide",img:"Paco_de_Lucía_4.jpg"},
   sports:{n:"Rafael Nadal",r:"22× Grand Slam champion — the \"King of Clay\"",img:"Rafael_Nadal_en_2024_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Spain"},{label:"Facts & figures",detail:"Wikipedia — \"Spain\" & related articles",url:"https://en.wikipedia.org/wiki/Spain"},{label:"Travel film",detail:"YouTube — \"SPAIN - Timeless Charms｜Cinematic Travel Video\" · Marko Gruntar",url:"https://www.youtube.com/watch?v=IaaFExw8Zt4"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Spain/@40.0,-3.7,5z"}] },
  IT: { tagline:"Il Bel Paese · where every road leads to beauty",
   photos:[{f:"Colosseo_2020.jpg",cap:"The Colosseum · Rome"},{f:"Venezia_aerial_view.jpg",cap:"The canals of Venice from above"},{f:"Cattedrale_di_Santa_Maria_del_Fiore_–_Il_Duomo_di_Firenze.jpg",cap:"Brunelleschi's Duomo · Florence"},{f:"Amalfi_Coast_(Italy,_October_2020)_-_75_(50558355441).jpg",cap:"The Amalfi Coast"},{f:"Portofino,_Italy_2025.jpg",cap:"Portofino harbor · Liguria"},{f:"Milan_Cathedral_from_Piazza_del_Duomo.jpg",cap:"The Duomo · Milan"},{f:"Cinque_Terre_(Italy,_October_2020)_-_24_(50543603956).jpg",cap:"Cinque Terre · the five lands"},{f:"Aerial_image_of_Pompeii_and_Mount_Vesuvius_(view_from_the_southeast).jpg",cap:"Pompeii beneath Vesuvius"},{f:"Sentiero_del_Viandante_DSC_6340_(14020554463).jpg",cap:"Lake Como"},{f:"Faloria_Cortina_d'Ampezzo_10.jpg",cap:"The Dolomites · Cortina d'Ampezzo"}],
   video:{id:"olf-OvqzGd0",title:"Italy by Train | 10 Days Itinerary to Rome, Florence & Venice",by:"MultiCityTrips"},
   cities:[{name:"Rome",lng:12.50,lat:41.90,capital:true},{name:"Milan",lng:9.19,lat:45.46},{name:"Naples",lng:14.27,lat:40.85},{name:"Turin",lng:7.69,lat:45.07},{name:"Florence",lng:11.26,lat:43.77},{name:"Venice",lng:12.34,lat:45.44},{name:"Bologna",lng:11.34,lat:44.49},{name:"Palermo",lng:13.36,lat:38.12}],
   maps:"https://www.google.com/maps/place/Italy/@42,12,5z",
   facts:{capital:"Rome (Roma)",population:"≈ 59 million (2024)",languages:"Italian (official)",langCount:"≈ 34 languages spoken in total",independence:"March 17, 1861 — Kingdom of Italy proclaimed; Republic since 1946",government:"Unitary parliamentary republic",etymology:"From <em>Italia</em> — an ancient name possibly meaning <em>land of calves</em> (cattle)."},
   people:[{n:"Julius Caesar",r:"general & statesman who reshaped Rome",img:"Retrato_de_Julio_César_(26724093101)_(cropped).jpg"},{n:"Leonardo da Vinci",r:"Renaissance polymath — artist & inventor",img:"Francesco_Melzi_-_Portrait_of_Leonardo.png"},{n:"Michelangelo",r:"sculptor & painter of the Sistine Chapel",img:"Michelangelo_Daniele_da_Volterra_(dettaglio).jpg"},{n:"Dante Alighieri",r:"poet — father of the Italian language",img:"Bargello_-_Kapelle_Fresko_2a.jpg"},{n:"Giuseppe Garibaldi",r:"hero of Italian unification",img:"Garibaldi_(1866).jpg"}],
   music:{n:"Luciano Pavarotti",r:"the greatest operatic tenor of his age",img:"Luciano_Pavarotti_2004.jpg"},
   sports:{n:"Valentino Rossi",r:"9× MotoGP world champion — \"The Doctor\"",img:"Valentino_Rossi_2024_WEC_Fuji_6.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Italy"},{label:"Facts & figures",detail:"Wikipedia — \"Italy\" & related articles",url:"https://en.wikipedia.org/wiki/Italy"},{label:"Travel film",detail:"YouTube — \"Italy by Train | 10 Days Itinerary to Rome, Florence & Venice\" · MultiCityTrips",url:"https://www.youtube.com/watch?v=olf-OvqzGd0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Italy/@42,12,5z"}] },
  GB: { tagline:"These islands — where the world learned to make noise",
   photos:[{f:"Elizabeth_Tower,_June_2022.jpg",cap:"Big Ben & Westminster · London"},{f:"Tower_Bridge_at_Dawn.jpg",cap:"Tower Bridge at dawn · London"},{f:"Stonehenge2007_07_30.jpg",cap:"Stonehenge · Wiltshire"},{f:"City_of_Edinburgh_-_Edinburgh_Castle_-_20140421004403.jpg",cap:"Edinburgh Castle · Scotland"},{f:"GlencoeVillage.jpg",cap:"Glen Coe · Scottish Highlands"},{f:"Derwent_Water,_Lake_District,_Cumbria_-_June_2009.jpg",cap:"Derwent Water · Lake District"},{f:"Roman_Baths_in_Bath_Spa,_England_-_July_2006.jpg",cap:"The Roman Baths · Bath"},{f:"Causeway-code_poet-4.jpg",cap:"Giant's Causeway · Northern Ireland"},{f:"Snowdon_Ranger_path_on_a_cold_February_day._(16431627106).jpg",cap:"Snowdonia (Eryri) · Wales"},{f:"Castle_combe_cotswolds.jpg",cap:"Castle Combe · the Cotswolds"}],
   video:{id:"rd1K1sBf1Ug",title:"THINGS TO KNOW BEFORE YOU GO TO THE UK",by:"Creative Travel Guide"},
   cities:[{name:"London",lng:-0.13,lat:51.51,capital:true},{name:"Birmingham",lng:-1.90,lat:52.48},{name:"Manchester",lng:-2.24,lat:53.48},{name:"Glasgow",lng:-4.25,lat:55.86},{name:"Edinburgh",lng:-3.19,lat:55.95},{name:"Liverpool",lng:-2.99,lat:53.41},{name:"Cardiff",lng:-3.18,lat:51.48},{name:"Belfast",lng:-5.93,lat:54.60}],
   maps:"https://www.google.com/maps/place/United+Kingdom/@54,-2,5z",
   facts:{capital:"London",population:"≈ 68.3 million (2024)",languages:"English (de facto); Welsh, Scottish Gaelic, Irish, Cornish, Scots",langCount:"≈ 15 languages spoken in total",independence:"Formed by union — Acts of Union 1707 (Great Britain) & 1801 (United Kingdom)",government:"Unitary parliamentary constitutional monarchy",etymology:"\"Britain\" from the <em>Pretani/Britanni</em> — the island's Celtic peoples — via Latin <em>Britannia</em>."},
   people:[{n:"Winston Churchill",r:"wartime PM — rallied Britain through WWII",img:"Sir_Winston_Churchill_-_19086236948_(restored).jpg"},{n:"William Shakespeare",r:"the Bard — greatest writer in English",img:"William_Shakespeare_by_John_Taylor,_edited.jpg"},{n:"Isaac Newton",r:"gravity, motion & calculus — modern physics",img:"Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"},{n:"Charles Darwin",r:"naturalist — theory of evolution",img:"Charles_Darwin_seated_crop.jpg"},{n:"Elizabeth I",r:"Gloriana — queen of England's golden age",img:"Darnley_stage_3.jpg"}],
   music:{n:"The Beatles",r:"the best-selling band in history — from Liverpool",img:"The_Beatles_1963_Dezo_Hoffman_Capitol_Records_press_photo_2.jpg"},
   sports:{n:"David Beckham",r:"football icon — free-kick maestro turned global star",img:"David_Beckham_UNICEF_(cropped2).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:United_Kingdom"},{label:"Facts & figures",detail:"Wikipedia — \"United Kingdom\" & related articles",url:"https://en.wikipedia.org/wiki/United_Kingdom"},{label:"Travel film",detail:"YouTube — \"THINGS TO KNOW BEFORE YOU GO TO THE UK\" · Creative Travel Guide",url:"https://www.youtube.com/watch?v=rd1K1sBf1Ug"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/United+Kingdom/@54,-2,5z"}] },
  US: { tagline:"Sea to shining sea · fifty states, one restless dream",
   photos:[{f:"View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_(cropped).jpg",cap:"Manhattan skyline · New York City"},{f:"Canyon_River_Tree_(165872763).jpeg",cap:"The Grand Canyon · Arizona"},{f:"Golden_Gate_Bridge_as_seen_from_Battery_East.jpg",cap:"Golden Gate Bridge · San Francisco"},{f:"Statue_of_liberty_and_nyc_skyline.jpg",cap:"Statue of Liberty · New York Harbor"},{f:"Grand_Canyon_of_yellowstone.jpg",cap:"Grand Canyon of the Yellowstone · Wyoming"},{f:"Las_Vegas_Strip_09_2017_4897.jpg",cap:"The Strip after dark · Las Vegas"},{f:"Capitol_Building_Full_View.jpg",cap:"The U.S. Capitol · Washington, D.C."},{f:"French_Quarter,_looking_north_with_Mississippi_River_to_the_right_2011.jpg",cap:"The French Quarter · New Orleans"},{f:"Monument_Valley,_Utah,_USA_(23611451292).jpg",cap:"Monument Valley · Utah–Arizona border"},{f:"Central_Californian_Coastline,_Big_Sur_-_May_2013.jpg",cap:"The Big Sur coast · California"}],
   video:{id:"Yaw22v_lG80",title:"10 DAY USA ROAD TRIP — Yosemite, Sequoia, Death Valley, Zion, Bryce, Vegas",by:"Karl Watson: Travel Documentaries"},
   cities:[{name:"Washington, D.C.",lng:-77.04,lat:38.91,capital:true},{name:"New York",lng:-74.01,lat:40.71},{name:"Los Angeles",lng:-118.24,lat:34.05},{name:"Chicago",lng:-87.63,lat:41.88},{name:"Houston",lng:-95.37,lat:29.76},{name:"San Francisco",lng:-122.42,lat:37.77},{name:"Honolulu",lng:-157.86,lat:21.31},{name:"Anchorage",lng:-149.90,lat:61.22}],
   maps:"https://www.google.com/maps/place/United+States/@39.8,-98.6,4z",
   facts:{capital:"Washington, D.C.",population:"≈ 335 million (2024)",languages:"English (de facto national); Spanish widely spoken — no official language federally",langCount:"≈ 350+ languages spoken in total",independence:"July 4, 1776 — from Great Britain",government:"Federal presidential constitutional republic",etymology:"Named for Italian explorer <em>Amerigo Vespucci</em> — Latinized as <em>America</em>."},
   people:[{n:"George Washington",r:"first president — commander of the Revolution",img:"Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg"},{n:"Abraham Lincoln",r:"16th president — preserved the Union, ended slavery",img:"Abraham_Lincoln_1863_Portrait_(3x4_cropped).jpg"},{n:"Thomas Jefferson",r:"author of the Declaration of Independence",img:"Official_Presidential_portrait_of_Thomas_Jefferson_(by_Rembrandt_Peale,_1800).jpg"},{n:"Martin Luther King Jr.",r:"civil rights leader — \"I Have a Dream\"",img:"Martin_Luther_King,_Jr..jpg"},{n:"Benjamin Franklin",r:"founding father, inventor & diplomat",img:"Joseph_Siffrein_Duplessis_-_Benjamin_Franklin_-_Google_Art_Project.jpg"}],
   music:{n:"Michael Jackson",r:"the \"King of Pop\" — best-selling artist of all time",img:"Michael_Jackson_1983_(3x4_cropped)_(contrast).jpg"},
   sports:{n:"Muhammad Ali",r:"3× heavyweight boxing champion — \"The Greatest\"",img:"Muhammad_Ali_NYWTS.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:United_States"},{label:"Facts & figures",detail:"Wikipedia — \"United States\" & related articles",url:"https://en.wikipedia.org/wiki/United_States"},{label:"Travel film",detail:"YouTube — \"10 DAY USA ROAD TRIP\" · Karl Watson: Travel Documentaries",url:"https://www.youtube.com/watch?v=Yaw22v_lG80"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/United+States/@39.8,-98.6,4z"}] },
  EG: { tagline:"Umm al-Dunya · the Mother of the World, cradle of the Nile",
   photos:[{f:"Pyramids_of_the_Giza_Necropolis.jpg",cap:"Pyramids of Giza · Giza Plateau"},{f:"Sphinx_with_the_third_pyramid.jpg",cap:"The Great Sphinx · Giza"},{f:"Temple_de_Louxor_68.jpg",cap:"Karnak Temple · Luxor"},{f:"Luxor,_Tal_der_Könige_(1995,_860x605).jpg",cap:"Valley of the Kings · Luxor"},{f:"Ramsis,_Aswan_Governorate,_Egypt_-_panoramio.jpg",cap:"Abu Simbel · Aswan Governorate"},{f:"Cairo_Opera_House,_Al_Hurriyah_Park_and_the_Nile_river_(14797782354).jpg",cap:"Cairo & the Nile · from Zamalek"},{f:"Nile_3rd_Cataract_Left.jpg",cap:"The Nile · lifeblood of Egypt"},{f:"QaitbeyCitadel.jpg",cap:"Citadel of Qaitbay · Alexandria"},{f:"Panoramic_view_of_Aswan,_Egypt.jpg",cap:"Aswan · on the Upper Nile"},{f:"Al_Farafrah,_New_Valley_Governorate,_Egypt_-_panoramio_(21).jpg",cap:"White Desert · near Farafra"}],
   video:{id:"qMSLLNZkEb0",title:"Ultimate 12 Day Egypt Itinerary | Cairo, Luxor, Aswan, Abu Simbel & Siwa",by:"Go Global with Sibu"},
   cities:[{name:"Cairo",lng:31.24,lat:30.06,capital:true},{name:"Alexandria",lng:29.92,lat:31.20},{name:"Giza",lng:31.21,lat:30.01},{name:"Luxor",lng:32.64,lat:25.69},{name:"Aswan",lng:32.90,lat:24.09},{name:"Port Said",lng:32.30,lat:31.26},{name:"Sharm El Sheikh",lng:34.33,lat:27.92},{name:"Hurghada",lng:33.83,lat:27.26}],
   maps:"https://www.google.com/maps/place/Egypt/@26.8,30,5z",
   facts:{capital:"Cairo (Al-Qāhira)",population:"≈ 112 million (2024)",languages:"Arabic (official); Egyptian Arabic vernacular; Coptic (liturgical), Nubian",langCount:"≈ 12 languages spoken in total",independence:"February 28, 1922 — from the United Kingdom",government:"Unitary semi-presidential republic",etymology:"From Greek <em>Aígyptos</em>; the Arabic name is <em>Miṣr</em>."},
   people:[{n:"Ramesses II",r:"the Great — mightiest pharaoh of the New Kingdom",img:"Ramses_II_British_Museum.jpg"},{n:"Cleopatra VII",r:"last pharaoh of Ptolemaic Egypt",img:"Kleopatra-VII.-Altes-Museum-Berlin1.jpg"},{n:"Tutankhamun",r:"boy-king whose golden tomb dazzled the world",img:"CairoEgMuseumTaaMaskMostlyPhotographed.jpg"},{n:"Gamal Abdel Nasser",r:"president who led Arab nationalism",img:"Stevan_Kragujevic,_Gamal_Abdel_Naser_u_Beogradu,_1962.jpg"},{n:"Anwar Sadat",r:"president & Nobel peace laureate",img:"Official_Portrait_-_Anwar_Sadat.jpg"}],
   music:{n:"Umm Kulthum",r:"the \"Star of the East\" — the Arab world's greatest voice",img:"Umm_Kulthum_as_Fatimah.jpg"},
   sports:{n:"Mohamed Salah",r:"football superstar — the \"Egyptian King\"",img:"Mohamed_Salah_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Egypt"},{label:"Facts & figures",detail:"Wikipedia — \"Egypt\" & related articles",url:"https://en.wikipedia.org/wiki/Egypt"},{label:"Travel film",detail:"YouTube — \"Ultimate 12 Day Egypt Itinerary\" · Go Global with Sibu",url:"https://www.youtube.com/watch?v=qMSLLNZkEb0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Egypt/@26.8,30,5z"}] },
  KR: { tagline:"Land of the Morning Calm · where hanok meets hypermodern",
   photos:[{f:"Bukchon_Hanok_Village_01.jpg",cap:"Bukchon Hanok Village · Seoul"},{f:"광화문_월대.jpg",cap:"Gyeongbokgung Palace · Seoul"},{f:"Cheonggyecheon_stream_at_sunrise_with_trees_in_Seoul.jpg",cap:"Cheonggyecheon stream · Seoul"},{f:"Namsan_and_Namsan_Tour_at_Dusk.jpg",cap:"Seoul skyline at dusk"},{f:"Gwangan_Bridge1.jpg",cap:"Gwangan Bridge · Busan"},{f:"Gamcheon_Houses,_2024.jpg",cap:"Gamcheon Culture Village · Busan"},{f:"Jeju_Island.jpg",cap:"Jeju Island coast"},{f:"Seongsan_Ilchulbong_from_the_air.jpg",cap:"Seongsan Ilchulbong · Jeju"},{f:"Lotus_Flower_Bridge_and_Seven_Treasure_Bridge_at_Bulguksa_in_Gyeongju,_Korea.jpg",cap:"Bulguksa Temple · Gyeongju"},{f:"Dinosaur_Ridge_of_Seoraksan.jpg",cap:"Seoraksan National Park"}],
   video:{id:"AA-sv3ilNBE",title:"South Korea 4K Drone Video | Seoul, Busan, Songdo Cinematic Aerials",by:"Explore The World 4K"},
   cities:[{name:"Seoul",lng:126.98,lat:37.57,capital:true},{name:"Busan",lng:129.08,lat:35.18},{name:"Incheon",lng:126.71,lat:37.46},{name:"Daegu",lng:128.60,lat:35.87},{name:"Daejeon",lng:127.38,lat:36.35},{name:"Gwangju",lng:126.85,lat:35.16},{name:"Ulsan",lng:129.31,lat:35.54},{name:"Jeonju",lng:127.15,lat:35.82}],
   maps:"https://www.google.com/maps/place/South+Korea/@36.5,127.8,7z",
   facts:{capital:"Seoul",population:"≈ 51.7 million (2024)",languages:"Korean (official); Korean Sign Language",langCount:"≈ 3 languages spoken in total",independence:"Aug 15, 1945 — liberation from Japan; ROK founded Aug 15, 1948",government:"Unitary presidential republic",etymology:"From the medieval <em>Goryeo</em> dynasty; the Korean name is <em>Hanguk</em>."},
   people:[{n:"King Sejong the Great",r:"created Hangul, Korea's alphabet",img:"King_sejong_the_great_gwanghwamun_square_police-859145.jpg"},{n:"Yi Sun-sin",r:"admiral who never lost a naval battle",img:"Bust_of_Yi_Sun-sin_01.jpg"},{n:"Ahn Jung-geun",r:"independence activist — assassinated Itō Hirobumi",img:"An_Jung-geun.JPG"},{n:"Kim Gu",r:"leader of the Korean independence movement",img:"Kim_Gu_in_1949.jpg"},{n:"Yu Gwan-sun",r:"teenage martyr of the March 1st Movement",img:"Ryu_Gwan-sun.jpg"}],
   music:{n:"BTS",r:"the K-pop juggernaut that conquered the world",img:"BTS_during_a_White_House_press_conference_May_31,_2022_(cropped).jpg"},
   sports:{n:"Son Heung-min",r:"Tottenham captain — Premier League goal machine",img:"BFA_2023_-2_Heung-Min_Son_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:South_Korea"},{label:"Facts & figures",detail:"Wikipedia — \"South Korea\" & related articles",url:"https://en.wikipedia.org/wiki/South_Korea"},{label:"Travel film",detail:"YouTube — \"South Korea 4K Drone Video\" · Explore The World 4K",url:"https://www.youtube.com/watch?v=AA-sv3ilNBE"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/South+Korea/@36.5,127.8,7z"}] },
  CO: { tagline:"Land of a thousand rhythms · where the Andes meet two oceans",
   photos:[{f:"Centro_historico_de_Cartagena.jpg",cap:"Walled old city · Cartagena"},{f:"BOGOTA_CITY_(cropped).jpg",cap:"Andean skyline · Bogotá"},{f:"2017_Bogotá_Basílica_del_Señor_Caído_de_Monserrate.jpg",cap:"Monserrate sanctuary · Bogotá"},{f:"El_Poblado_Medellín.jpg",cap:"El Poblado · Medellín"},{f:"Grafitti_-_Plaza_-_Comuna_13_-_Medellín_-_Colombia_2024.jpg",cap:"Street art of Comuna 13 · Medellín"},{f:"View_of_Salento,_Colombia_01.jpg",cap:"Coffee country · Salento"},{f:"Valle_del_cocora_-_general_view.jpg",cap:"Wax palms of Cocora Valley"},{f:"Caño_Cristales_01.jpg",cap:"The \"river of five colors\" · Caño Cristales"},{f:"Arrecifes.jpg",cap:"Caribbean coast · Tayrona"},{f:"El_Peñol_de_Guatapé_(The_Rock_of_Guatape)_2017-04-10.jpg",cap:"El Peñol rock · Guatapé"}],
   video:{id:"DWchxY3XhXQ",title:"Exploring Colombia - Full Travel Documentary",by:"BackPacker Steve"},
   cities:[{name:"Bogotá",lng:-74.07,lat:4.71,capital:true},{name:"Medellín",lng:-75.56,lat:6.24},{name:"Cali",lng:-76.53,lat:3.45},{name:"Barranquilla",lng:-74.80,lat:10.97},{name:"Cartagena",lng:-75.51,lat:10.42},{name:"Bucaramanga",lng:-73.12,lat:7.12},{name:"Santa Marta",lng:-74.20,lat:11.24}],
   maps:"https://www.google.com/maps/place/Colombia/@4.6,-74,5z",
   facts:{capital:"Bogotá",population:"≈ 52.3 million (2024)",languages:"Spanish (official)",langCount:"≈ 70+ languages spoken in total",independence:"July 20, 1810 declared · Aug 7, 1819 from Spain",government:"Unitary presidential republic",etymology:"Named after <em>Christopher Columbus</em> — <em>Cristóbal Colón</em> in Spanish."},
   people:[{n:"Simón Bolívar",r:"El Libertador — led independence across the Andes",img:"Simón_Bolívar._Toro_Moreno,_Luis._1922,_Legislative_Palace,_La_Paz.png"},{n:"Francisco de Paula Santander",r:"\"Man of Laws\" — founding statesman & president",img:"Santander_by_Acevedo_Bernal.jpg"},{n:"Gabriel García Márquez",r:"Nobel novelist — father of magical realism",img:"Gabriel_Garcia_Marquez.jpg"},{n:"Policarpa Salavarrieta",r:"\"La Pola\" — martyr heroine of independence",img:"Policarpa_Salabarrieta.jpg"},{n:"Antonio Nariño",r:"precursor of independence — translated the Rights of Man",img:"Nariño_by_Acevedo_Bernal.jpg"}],
   music:{n:"Shakira",r:"the global pop superstar from Barranquilla",img:"2023-11-16_Gala_de_los_Latin_Grammy,_03_(cropped)02.jpg"},
   sports:{n:"James Rodríguez",r:"playmaker — 2014 World Cup Golden Boot winner",img:"James_Rodriguez_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Colombia"},{label:"Facts & figures",detail:"Wikipedia — \"Colombia\" & related articles",url:"https://en.wikipedia.org/wiki/Colombia"},{label:"Travel film",detail:"YouTube — \"Exploring Colombia - Full Travel Documentary\" · BackPacker Steve",url:"https://www.youtube.com/watch?v=DWchxY3XhXQ"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Colombia/@4.6,-74,5z"}] },
  JM: { tagline:"Xaymaca · land of wood and water",
   photos:[{f:"Dunns_River_Falls_climb.JPG",cap:"Dunn's River Falls · Ocho Rios"},{f:"Negril_Jamaica_2007-09.jpg",cap:"Seven Mile Beach · Negril"},{f:"JM_Blue_Mountain_Peak_1010_(78)_(17049629637).jpg",cap:"Blue Mountain Peak"},{f:"PortofKingston.jpg",cap:"Kingston Harbour · the capital"},{f:"Montego_Bay_Photo_Don_Ramey_Logan.jpg",cap:"Montego Bay"},{f:"JM-ocho_rios-hafen-01.jpg",cap:"Ocho Rios waterfront"},{f:"Port_antonio2.JPG",cap:"Port Antonio · the northeast coast"},{f:"Devonhouse.jpg",cap:"Devon House · Kingston"},{f:"St.-Jago-de-la-Vega.JPG",cap:"Spanish Town · the old capital"},{f:"Farming_on_the_slopes_of_the_John_Crow.jpg",cap:"John Crow Mountains · Rio Grande valley"}],
   video:{id:"Y9vAska3-as",title:"OCHO RIOS | 10 Amazing Things to do",by:"LIST - Life In Style Travel"},
   cities:[{name:"Kingston",lng:-76.79,lat:17.97,capital:true},{name:"Montego Bay",lng:-77.92,lat:18.47},{name:"Spanish Town",lng:-76.95,lat:17.99},{name:"Portmore",lng:-76.88,lat:17.95},{name:"Ocho Rios",lng:-77.10,lat:18.41},{name:"Negril",lng:-78.35,lat:18.27},{name:"Port Antonio",lng:-76.45,lat:18.18}],
   maps:"https://www.google.com/maps/place/Jamaica/@18.1,-77.3,8z",
   facts:{capital:"Kingston",population:"≈ 2.8 million (2024)",languages:"English (official); Jamaican Patois widely spoken",langCount:"≈ 3 languages spoken in total",independence:"August 6, 1962 — from the United Kingdom",government:"Unitary parliamentary constitutional monarchy",etymology:"From the Taíno <em>Xaymaca</em> — \"land of wood and water.\""},
   people:[{n:"Marcus Garvey",r:"national hero — Pan-Africanist leader & orator",img:"Marcus_Garvey,_\"Provisional_President_of_Africa\",_by_the_Keystone_View_Company.jpg"},{n:"Alexander Bustamante",r:"national hero — first Prime Minister",img:"Prime_Minister_of_Jamaica,_Sir_Alexander_Bustamante_(04)_(cropped).jpg"},{n:"Norman Manley",r:"national hero — independence-era statesman",img:"Norman_Manley,_The_Miami_Herald_1955_08_04_(cropped).jpg"},{n:"Paul Bogle",r:"national hero — led the Morant Bay rebellion",img:"PaulBogle-MorantBay.jpg"},{n:"Samuel Sharpe",r:"national hero — led the 1831 slave revolt",img:"Samsharpe.JPG"}],
   music:{n:"Bob Marley",r:"reggae legend — global voice of Jamaica",img:"Bob_Marley_1976_press_photo.jpg"},
   sports:{n:"Usain Bolt",r:"8× Olympic champion — fastest man ever",img:"Usain_Bolt_smiling_Berlin_2009.JPG"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Jamaica"},{label:"Facts & figures",detail:"Wikipedia — \"Jamaica\" & related articles",url:"https://en.wikipedia.org/wiki/Jamaica"},{label:"Travel film",detail:"YouTube — \"OCHO RIOS | 10 Amazing Things to do\" · LIST - Life In Style Travel",url:"https://www.youtube.com/watch?v=Y9vAska3-as"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Jamaica/@18.1,-77.3,8z"}] },
  CA: { tagline:"The True North · strong and free — from Rockies to two shining oceans",
   photos:[{f:"Moraine_Lake_17092005.jpg",cap:"Moraine Lake · Banff National Park"},{f:"Lake_Louise_in_Banff_National_Park,_boat_view_2.jpg",cap:"Lake Louise · Alberta Rockies"},{f:"Toronto_Skyline_from_Snake_Island,_February_28_2026_(08).jpg",cap:"Toronto skyline & CN Tower"},{f:"Skyline_of_Vancouver,_Canada.jpg",cap:"Vancouver · mountains meet sea"},{f:"3Falls_Niagara.jpg",cap:"Niagara Falls · Ontario"},{f:"Château_Frontenac_02.jpg",cap:"Château Frontenac · Old Québec City"},{f:"Ottawa_-_ON_-_Stadtansicht.jpg",cap:"Parliament Hill · Ottawa"},{f:"Montreal,_Quebec_skyline.jpg",cap:"Montréal skyline · Québec"},{f:"Peggys_Cove_Harbour_01.jpg",cap:"Peggy's Cove · Nova Scotia coast"},{f:"Aurora Borealis (47533341121).jpg",cap:"Northern lights · Whitehorse, Yukon"}],
   video:{id:"Gl7m0cVa37k",title:"10 Days in Canada Vlog - Banff, Lake Louise, Jasper",by:"Suitcase Monkey"},
   cities:[{name:"Ottawa",lng:-75.70,lat:45.42,capital:true},{name:"Toronto",lng:-79.38,lat:43.65},{name:"Montréal",lng:-73.57,lat:45.50},{name:"Vancouver",lng:-123.12,lat:49.28},{name:"Calgary",lng:-114.07,lat:51.05},{name:"Edmonton",lng:-113.49,lat:53.55},{name:"Québec City",lng:-71.21,lat:46.81},{name:"Winnipeg",lng:-97.14,lat:49.90}],
   maps:"https://www.google.com/maps/place/Canada/@56.1,-106.3,4z",
   facts:{capital:"Ottawa",population:"≈ 41.5 million (2024)",languages:"English & French (official)",langCount:"≈ 200+ languages spoken in total",independence:"July 1, 1867 — Confederation; full sovereignty via the Statute of Westminster (1931)",government:"Federal parliamentary constitutional monarchy",etymology:"From the St. Lawrence Iroquoian <em>kanata</em> — \"village\" or \"settlement.\""},
   people:[{n:"Sir John A. Macdonald",r:"first Prime Minister — father of Confederation",img:"John_A_Macdonald_(ca._1875).jpg"},{n:"Sir Wilfrid Laurier",r:"first French-Canadian PM — nation-builder",img:"The_Honourable_Sir_Wilfrid_Laurier_Photo_A_(3x4_cropped).jpg"},{n:"Louis Riel",r:"Métis leader — founder of Manitoba",img:"Louis_Riel.jpg"},{n:"Tommy Douglas",r:"father of Canadian universal healthcare",img:"Premier_Tommy_Douglas_(F1257_s1057_it2743).jpg"},{n:"Terry Fox",r:"Marathon of Hope — national icon",img:"TerryFoxToronto19800712.JPG"}],
   music:{n:"Céline Dion",r:"one of the best-selling artists of all time",img:"Céline_Dion_2012.jpg"},
   sports:{n:"Wayne Gretzky",r:"\"The Great One\" — hockey's greatest scorer",img:"Andrew_Scheer_with_Wayne_Gretzky_(48055697168)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Canada"},{label:"Facts & figures",detail:"Wikipedia — \"Canada\" & related articles",url:"https://en.wikipedia.org/wiki/Canada"},{label:"Travel film",detail:"YouTube — \"10 Days in Canada Vlog\" · Suitcase Monkey",url:"https://www.youtube.com/watch?v=Gl7m0cVa37k"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Canada/@56.1,-106.3,4z"}] },
  AU: { tagline:"The Land Down Under · sunburnt country, boundless plains",
   photos:[{f:"Sydney_Opera_House_and_Harbour_Bridge_Dusk_(2)_2019-06-21.jpg",cap:"Opera House & Harbour Bridge · Sydney"},{f:"Uluru.jpg",cap:"Uluru · Red Centre"},{f:"ISS-45_StoryOfWater,_Great_Barrier_Reef,_Australia.jpg",cap:"Great Barrier Reef · from orbit"},{f:"The_Twelve_Apostles_2011.jpg",cap:"Twelve Apostles · Great Ocean Road"},{f:"Melbourne_skyline_sor.jpg",cap:"Melbourne skyline · Victoria"},{f:"Bondi_from_above.jpg",cap:"Bondi Beach · Sydney"},{f:"Three_Sisters_Sunset.jpg",cap:"Three Sisters · Blue Mountains"},{f:"Flinders_Chase_National_Park_01.jpg",cap:"Flinders Chase · Kangaroo Island"},{f:"Whitehaven_Beach,_Whitsunday_Island,_Queensland.jpg",cap:"Whitehaven Beach · Whitsundays"},{f:"A192,_Port_Campbell_National_Park,_Australia,_Twelve_Apostles_sea_stacks_from_helicopter,_2007.JPG",cap:"Port Campbell coast · Victoria"}],
   video:{id:"-dEsZOFoZI8",title:"Australia in 10 days: Melbourne, Sydney, Cairns, Uluru",by:"Travel-Notes"},
   cities:[{name:"Canberra",lng:149.13,lat:-35.28,capital:true},{name:"Sydney",lng:151.21,lat:-33.87},{name:"Melbourne",lng:144.96,lat:-37.81},{name:"Brisbane",lng:153.03,lat:-27.47},{name:"Perth",lng:115.86,lat:-31.95},{name:"Adelaide",lng:138.60,lat:-34.93},{name:"Gold Coast",lng:153.43,lat:-28.00},{name:"Darwin",lng:130.84,lat:-12.46}],
   maps:"https://www.google.com/maps/place/Australia/@-25.27,133.77,4z",
   facts:{capital:"Canberra",population:"≈ 27.2 million (2024)",languages:"English (de facto national); 150+ Indigenous languages",langCount:"≈ 300+ languages spoken in total",independence:"Jan 1, 1901 — Federation; full sovereignty via Statute of Westminster (1942) & Australia Act (1986)",government:"Federal parliamentary constitutional monarchy",etymology:"From Latin <em>terra australis</em> — \"the <em>southern land</em>.\""},
   people:[{n:"Edmund Barton",r:"Australia's first Prime Minister, 1901",img:"Edmund_Barton_-_Swiss_Studios_(b&w).jpg"},{n:"Sir Henry Parkes",r:"the \"Father of Federation\"",img:"Henryparkes.jpg"},{n:"Captain James Cook",r:"charted the east coast in 1770",img:"Captainjamescookportrait.jpg"},{n:"Ned Kelly",r:"armour-clad bushranger & folk legend",img:"Ned_Kelly_in_1880.png"},{n:"Edith Cowan",r:"first woman elected to an Australian parliament",img:"Edith_Cowan_1900.jpg"}],
   music:{n:"AC/DC",r:"one of the best-selling rock bands ever",img:"AC_DC_Black_Ice_Tour_2009_Buenos_Aires_4_de_Diciembre_(4238680962).jpg"},
   sports:{n:"Cathy Freeman",r:"Olympic 400m champion — Sydney 2000",img:"Cathy_Freeman_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Australia"},{label:"Facts & figures",detail:"Wikipedia — \"Australia\" & related articles",url:"https://en.wikipedia.org/wiki/Australia"},{label:"Travel film",detail:"YouTube — \"Australia in 10 days\" · Travel-Notes",url:"https://www.youtube.com/watch?v=-dEsZOFoZI8"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Australia/@-25.27,133.77,4z"}] },
  DE: { tagline:"Deutschland · the beating heart of Europe",
   photos:[{f:"Schloss_Neuschwanstein_2013.jpg",cap:"Neuschwanstein Castle · Bavaria"},{f:"Brandenburger_Tor_abends.jpg",cap:"Brandenburg Gate · Berlin"},{f:"Kölner_Dom_-_Westfassade_2022_ohne_Gerüst-0968_b.jpg",cap:"Cologne Cathedral · Köln"},{f:"Rathaus_and_Marienplatz_from_Peterskirche_-_August_2006.jpg",cap:"Marienplatz · Munich"},{f:"O'zapft_is!_Münchens_5_Jahreszeit_hat_begonnen_-_O'zapft_is!_Munich_5_season,_the_Oktoberfest_has_begun_(9855483374).jpg",cap:"Oktoberfest · Munich"},{f:"Bayerische_Alpen.JPG",cap:"The Bavarian Alps"},{f:"St.Goarshausen_Loreley_Burg_Katz_2016-03-27-17-13-57.jpg",cap:"Burg Katz & the Loreley · Rhine Valley"},{f:"Speicherstadt_abends.jpg",cap:"Speicherstadt · Hamburg"},{f:"Blick_vom_Hohfelsen.jpg",cap:"The Black Forest"},{f:"Königstuhl,_Heidelberg,_U-17.jpg",cap:"Heidelberg · the Neckar"}],
   video:{id:"8DR3homwIrY",title:"5 Must-sees in Germany",by:"DW Travel"},
   cities:[{name:"Berlin",lng:13.40,lat:52.52,capital:true},{name:"Hamburg",lng:9.99,lat:53.55},{name:"Munich",lng:11.58,lat:48.14},{name:"Cologne",lng:6.96,lat:50.94},{name:"Frankfurt",lng:8.68,lat:50.11},{name:"Stuttgart",lng:9.18,lat:48.78},{name:"Düsseldorf",lng:6.78,lat:51.23},{name:"Dresden",lng:13.74,lat:51.05}],
   maps:"https://www.google.com/maps/place/Germany/@51.2,10.4,5z",
   facts:{capital:"Berlin",population:"≈ 84.7 million (2024)",languages:"German (official); Sorbian, Danish, Frisian & Romani recognized",langCount:"≈ 20+ languages spoken in total",independence:"Jan 18, 1871 — unification of the German Empire; reunified Oct 3, 1990",government:"Federal parliamentary republic",etymology:"English \"Germany\" from Latin <em>Germania</em>; German <em>Deutschland</em> from <em>diutisc</em>, \"of the people.\""},
   people:[{n:"Otto von Bismarck",r:"\"Iron Chancellor\" — unifier of Germany",img:"Otto_von_Bismarck_1885_(cropped).jpg"},{n:"Martin Luther",r:"friar who sparked the Protestant Reformation",img:"Lucas_Cranach_d.Ä._-_Martin_Luther,_1528_(Veste_Coburg).jpg"},{n:"Johann Wolfgang von Goethe",r:"poet & polymath — author of Faust",img:"Goethe_(Stieler_1828).jpg"},{n:"Albert Einstein",r:"physicist — theory of relativity",img:"Albert_Einstein_Head_cleaned.jpg"},{n:"Konrad Adenauer",r:"first postwar West German chancellor",img:"Bundesarchiv_B_145_Bild-F078072-0004,_Konrad_Adenauer.jpg"}],
   music:{n:"Ludwig van Beethoven",r:"towering composer — bridge to the Romantic era",img:"Joseph_Karl_Stieler's_Beethoven_mit_dem_Manuskript_der_Missa_solemnis.jpg"},
   sports:{n:"Michael Schumacher",r:"7× Formula 1 world champion",img:"Aécio_Neves,_Michael_Schumacher_e_Didi_(Cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Germany"},{label:"Facts & figures",detail:"Wikipedia — \"Germany\" & related articles",url:"https://en.wikipedia.org/wiki/Germany"},{label:"Travel film",detail:"YouTube — \"5 Must-sees in Germany\" · DW Travel",url:"https://www.youtube.com/watch?v=8DR3homwIrY"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Germany/@51.2,10.4,5z"}] },
  PT: { tagline:"Terra à beira-mar plantada · where Europe meets the Atlantic",
   photos:[{f:"Lisboa_-_Portugal_(52597836992).jpg",cap:"Lisbon skyline · the city of seven hills"},{f:"Torre_Belém_April_2009-4a.jpg",cap:"Belém Tower · Lisbon"},{f:"Lisbon_alfalma.jpg",cap:"Alfama · Lisbon's oldest quarter"},{f:"Dom_Luís_I_Bridge_(36961760686).jpg",cap:"Dom Luís I Bridge · Porto"},{f:"Puente_Don_Luis_I,_Oporto,_Portugal,_2012-05-09,_DD_13.JPG",cap:"Ribeira riverfront · Porto"},{f:"Sintra_-_Palacio_da_Pena_(20332995770)_(cropped2).jpg",cap:"Pena Palace · Sintra"},{f:"Praia_de_Benagil_-_Portugal_🇵🇹_(53651979938).jpg",cap:"Benagil sea cave · the Algarve"},{f:"Rio_Douro_-_Portugal_(32615481975)_(cropped).jpg",cap:"Terraced vineyards · the Douro Valley"},{f:"Ponta_de_São_Lourenço_north_north_east.jpg",cap:"Ponta de São Lourenço · Madeira"},{f:"Óbidos_view592.jpg",cap:"Whitewashed walls · Óbidos"}],
   video:{id:"JBCXQUGtPWg",title:"Discover Wonders of Portugal | 4K",by:"Travel Pulse TV"},
   cities:[{name:"Lisbon",lng:-9.14,lat:38.72,capital:true},{name:"Porto",lng:-8.61,lat:41.15},{name:"Braga",lng:-8.43,lat:41.55},{name:"Coimbra",lng:-8.43,lat:40.21},{name:"Faro",lng:-7.93,lat:37.02},{name:"Funchal",lng:-16.91,lat:32.65},{name:"Aveiro",lng:-8.65,lat:40.64},{name:"Évora",lng:-7.91,lat:38.57}],
   maps:"https://www.google.com/maps/place/Portugal/@39.5,-8,6z",
   facts:{capital:"Lisbon (Lisboa)",population:"≈ 10.6 million (2024)",languages:"Portuguese (official); Mirandese (co-official)",langCount:"≈ 5 languages spoken in total",independence:"1143 — from León (Treaty of Zamora); republic since 1910",government:"Unitary semi-presidential republic",etymology:"From <em>Portus Cale</em>, the Roman-era port at the mouth of the <em>Douro</em>."},
   people:[{n:"Afonso Henriques",r:"first king — founder of Portugal",img:"D._Afonso_Henriques_-_Compendio_de_crónicas_de_reyes_(Biblioteca_Nacional_de_España).png"},{n:"Vasco da Gama",r:"navigator — first sea route to India",img:"Ignoto_portoghese,_ritratto_di_un_cavaliere_dell'ordine_di_cristo,_1525-50_ca._02.jpg"},{n:"Prince Henry the Navigator",r:"patron of the Age of Discovery",img:"Henry_the_Navigator1.jpg"},{n:"Luís de Camões",r:"national poet — author of Os Lusíadas",img:"Camões,_por_Fernão_Gomes.jpg"},{n:"Fernando Pessoa",r:"modernist poet of many heteronyms",img:"Pessoa_chapeu.jpg"}],
   music:{n:"Amália Rodrigues",r:"the \"Queen of Fado\"",img:"Amália_Rodrigues_('Fado_et_Flamenco',_Columbia,_1956),_cropped.png"},
   sports:{n:"Cristiano Ronaldo",r:"5× Ballon d'Or — football icon",img:"Cristiano_Ronaldo_2275_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Portugal"},{label:"Facts & figures",detail:"Wikipedia — \"Portugal\" & related articles",url:"https://en.wikipedia.org/wiki/Portugal"},{label:"Travel film",detail:"YouTube — \"Discover Wonders of Portugal | 4K\" · Travel Pulse TV",url:"https://www.youtube.com/watch?v=JBCXQUGtPWg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Portugal/@39.5,-8,6z"}] },
  GR: { tagline:"Ελλάς · where the West wrote its first chapter",
   photos:[{f:"The_Parthenon_in_Athens.jpg",cap:"The Parthenon · Acropolis of Athens"},{f:"Oia_-_Santorini_2019.jpg",cap:"Whitewashed Oia · Santorini"},{f:"Chora_Windmills,_Mykonos,_Greece_(53507028405).jpg",cap:"The windmills of Chora · Mykonos"},{f:"Meteora's_monastery_2.jpg",cap:"Cliff-top monasteries · Metéora"},{f:"Delphi,_Greece_-_panoramio.jpg",cap:"Ancient Delphi · navel of the world"},{f:"1007_Bourtzi_Castle_in_Nafplio_Photo_by_Giles_Laurent.jpg",cap:"Bourtzi fortress · Nafplio"},{f:"Rhodes_at_dusk_from_the_pier_2010.jpg",cap:"Medieval old town at dusk · Rhodes"},{f:"Navagio,_Zante_01.jpg",cap:"Navagio (Shipwreck) Beach · Zákynthos"},{f:"Island_of_Crete,_Greece.JPG",cap:"Rugged coastline · Crete"},{f:"Elounda_02.jpg",cap:"Turquoise bays of Elounda · Crete"}],
   video:{id:"AKGkbdILcjU",title:"Top 10 Greek Islands To Visit",by:"Ryan Shirley"},
   cities:[{name:"Athens",lng:23.73,lat:37.98,capital:true},{name:"Thessaloniki",lng:22.94,lat:40.64},{name:"Patras",lng:21.73,lat:38.25},{name:"Heraklion",lng:25.13,lat:35.34},{name:"Larissa",lng:22.42,lat:39.64},{name:"Rhodes",lng:28.22,lat:36.44},{name:"Chania",lng:24.02,lat:35.51}],
   maps:"https://www.google.com/maps/place/Greece/@39,22,6z",
   facts:{capital:"Athens (Αθήνα)",population:"≈ 10.4 million (2024)",languages:"Greek (official)",langCount:"≈ 12 languages spoken in total",independence:"Mar 25, 1821 — declared from the Ottoman Empire (recognized 1830)",government:"Unitary parliamentary republic",etymology:"English <em>Greece</em> comes from Latin <em>Graecia</em>; the Greek name is <em>Hellas</em> (Ελλάς)."},
   people:[{n:"Alexander the Great",r:"king who forged an empire to India",img:"Alexander_Mosaic_detail_of_Alexander_the_Great_(3x4_cropped).jpg"},{n:"Socrates",r:"father of Western philosophy",img:"Socrates_Louvre.jpg"},{n:"Aristotle",r:"polymath who shaped Western thought",img:"Aristotle_Altemps_Inv8575.jpg"},{n:"Homer",r:"poet of the Iliad and Odyssey",img:"Homer_At_the_British_Museum_2024_(3x4_cropped).jpg"},{n:"Pericles",r:"statesman of Athens' Golden Age",img:"Pericles_Pio-Clementino_Inv269_n2.jpg"}],
   music:{n:"Mikis Theodorakis",r:"composer of \"Zorba the Greek\"",img:"Mikis_Theodorakis_Fabrik_070004.jpg"},
   sports:{n:"Giannis Antetokounmpo",r:"NBA champion & 2× MVP — the \"Greek Freak\"",img:"Giannis_Antetokounmpo_(51915153421)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Greece"},{label:"Facts & figures",detail:"Wikipedia — \"Greece\" & related articles",url:"https://en.wikipedia.org/wiki/Greece"},{label:"Travel film",detail:"YouTube — \"Top 10 Greek Islands To Visit\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=AKGkbdILcjU"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Greece/@39,22,6z"}] },
  NL: { tagline:"Nederland · the low country that engineered its own map",
   photos:[{f:"Amsterdam Prinsengracht Wallpaper.jpg",cap:"Prinsengracht canal · Amsterdam"},{f:"The windmills of Kinderdijk.JPG",cap:"Windmills of Kinderdijk"},{f:"Tulip garden Keukenhof 1.jpg",cap:"Tulip fields · Keukenhof"},{f:"Cube houses (DSC 3076).jpg",cap:"Cube Houses · Rotterdam"},{f:"Binnenhof, The Hague 1834.jpg",cap:"Binnenhof · The Hague"},{f:"Giethoorn (11053086563).jpg",cap:"Giethoorn · the village of canals"},{f:"The Windmills of Zaanse Schans, Netherlands.jpg",cap:"Zaanse Schans windmills"},{f:"Oudegracht (old canal) in Utrecht.jpg",cap:"Oudegracht · Utrecht"},{f:"Dutch polder landscape (20313246535).jpg",cap:"Polder countryside"},{f:"Erasmus bridge and Rotterdam skyline (21458216300).jpg",cap:"Erasmusbrug & skyline · Rotterdam"}],
   video:{id:"kwYczEUr9Fg",title:"Netherlands Travel Guide - Best Cities to Visit",by:"Travel Ranked"},
   cities:[{name:"Amsterdam",lng:4.90,lat:52.37,capital:true},{name:"Rotterdam",lng:4.48,lat:51.92},{name:"The Hague",lng:4.30,lat:52.08},{name:"Utrecht",lng:5.12,lat:52.09},{name:"Eindhoven",lng:5.48,lat:51.44},{name:"Groningen",lng:6.57,lat:53.22},{name:"Maastricht",lng:5.69,lat:50.85}],
   maps:"https://www.google.com/maps/place/Netherlands/@52.1,5.3,7z",
   facts:{capital:"Amsterdam (seat of government in The Hague)",population:"≈ 18.0 million (2024)",languages:"Dutch (official); Frisian co-official in Friesland",langCount:"≈ 15 languages spoken in total",independence:"July 26, 1581 — Act of Abjuration from Spain; recognized 1648 (Peace of Westphalia)",government:"Unitary parliamentary constitutional monarchy",etymology:"Dutch <em>Nederland</em> — the \"low country/lands\", most of it near or below sea level."},
   people:[{n:"William the Silent",r:"father of the Dutch fatherland — led the revolt",img:"William_I,_Prince_of_Orange_by_Adriaen_Thomasz._Key_Rijksmuseum_Amsterdam_SK-A-3148.jpg"},{n:"Rembrandt",r:"master painter of the Dutch Golden Age",img:"Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.jpg"},{n:"Vincent van Gogh",r:"post-Impressionist painter — global icon",img:"Vincent_van_Gogh_-_Self-Portrait_-_Google_Art_Project_(454045).jpg"},{n:"Baruch Spinoza",r:"Enlightenment philosopher — rationalist pioneer",img:"Spinoza.jpg"},{n:"Anne Frank",r:"diarist — voice of the Holocaust",img:"Anne_Frank_passport_photo,_May_1942_(cropped).jpg"}],
   music:{n:"André Rieu",r:"\"King of the Waltz\" — world's top touring maestro",img:"Andre_Rieu_2010.jpg"},
   sports:{n:"Johan Cruyff",r:"Total Football legend — reinvented the game",img:"Johan_Cruijff_(1974).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Netherlands"},{label:"Facts & figures",detail:"Wikipedia — \"Netherlands\" & related articles",url:"https://en.wikipedia.org/wiki/Netherlands"},{label:"Travel film",detail:"YouTube — \"Netherlands Travel Guide\" · Travel Ranked",url:"https://www.youtube.com/watch?v=kwYczEUr9Fg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Netherlands/@52.1,5.3,7z"}] },
  ZA: { tagline:"iRhawuti · a whole world in one country",
   photos:[{f:"Camps_bay_(53460319478)_(cropped).jpg",cap:"Camps Bay & Table Mountain · Cape Town"},{f:"Table_Mountain_DanieVDM.jpg",cap:"Table Mountain rising over the city"},{f:"Playa_Dias,_Cape_Point,_Sudáfrica,_2018-07-23,_DD_103.jpg",cap:"Cape of Good Hope · where two oceans meet"},{f:"Kruger_Zebra.JPG",cap:"Zebra on safari · Kruger National Park"},{f:"20131119_162543b.jpg",cap:"Blyde River Canyon · the Panorama Route"},{f:"Tsitsikamma_Park.JPG",cap:"Tsitsikamma coast · the Garden Route"},{f:"Johannesburg_skyline_2017.jpg",cap:"Johannesburg skyline · the City of Gold"},{f:"South_Africa_-_Drakensberg_(16261357780).jpg",cap:"The Drakensberg · the Dragon Mountains"},{f:"Boulders_Beach_Suedafrika.jpg",cap:"African penguins · Boulders Beach"},{f:"Knysna_waterfront.jpg",cap:"Knysna lagoon · Garden Route jewel"}],
   video:{id:"ITuxoCwt060",title:"South Africa Travel Documentary - the Garden Route [4K]",by:"lostintravel.at"},
   cities:[{name:"Pretoria",lng:28.19,lat:-25.75,capital:true},{name:"Cape Town",lng:18.42,lat:-33.92},{name:"Bloemfontein",lng:26.21,lat:-29.12},{name:"Johannesburg",lng:28.05,lat:-26.20},{name:"Durban",lng:31.02,lat:-29.86},{name:"Gqeberha (Port Elizabeth)",lng:25.60,lat:-33.96},{name:"East London",lng:27.91,lat:-33.02}],
   maps:"https://www.google.com/maps/place/South+Africa/@-30,25,5z",
   facts:{capital:"Pretoria (executive) · Cape Town · Bloemfontein",population:"≈ 62 million (2024)",languages:"12 official — Zulu, Xhosa, Afrikaans, English & more",langCount:"≈ 35 languages spoken in total",independence:"May 31, 1910 — Union of South Africa; republic 1961; democratic 1994",government:"Unitary parliamentary republic",etymology:"Named for its geographic position at the <em>southern tip of Africa</em>."},
   people:[{n:"Nelson Mandela",r:"anti-apartheid icon — first democratic president",img:"Nelson_Mandela_1994.jpg"},{n:"Desmond Tutu",r:"archbishop & Nobel Peace laureate",img:"Archbishop-Tutu-medium.jpg"},{n:"Steve Biko",r:"martyred Black Consciousness leader",img:"Steve_Biko_on_Flyer_for_Steve_Biko_Memorial_at_the_Carver_Cultural_Center.jpg"},{n:"Oliver Tambo",r:"longtime ANC president in exile",img:"Oliver_Tambo_(1981).jpg"},{n:"Shaka Zulu",r:"founding king of the Zulu nation",img:"KingShaka.jpg"}],
   music:{n:"Miriam Makeba",r:"\"Mama Africa\" — Grammy-winning global voice",img:"Miriam_makeba_01.jpg"},
   sports:{n:"Siya Kolisi",r:"first Black Springbok captain — 2× World Cup winner",img:"Siya_Kolisi_2022.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:South_Africa"},{label:"Facts & figures",detail:"Wikipedia — \"South Africa\" & related articles",url:"https://en.wikipedia.org/wiki/South_Africa"},{label:"Travel film",detail:"YouTube — \"South Africa Travel Documentary\" · lostintravel.at",url:"https://www.youtube.com/watch?v=ITuxoCwt060"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/South+Africa/@-30,25,5z"}] },
  TR: { tagline:"Where East meets West · two continents, one soul",
   photos:[{f:"Hagia_Sophia_(228968325).jpeg",cap:"Hagia Sophia · Istanbul"},{f:"Blue-Mosque-Istanbul-October-2012.jpg",cap:"The Blue Mosque · Istanbul"},{f:"Bosphorus, aerial view - Turkey - panoramio.jpg",cap:"The Bosphorus splitting two continents"},{f:"Cappadocia balloon trip, Ortahisar Castle (11893715185).jpg",cap:"Balloons over Cappadocia's fairy chimneys"},{f:"Pamukkale, Denizli 2026 68.jpg",cap:"Pamukkale's travertine terraces"},{f:"Ephesus Celsus Library Façade.jpg",cap:"Library of Celsus · ancient Ephesus"},{f:"Falezlerden Antalya Konyaaltı Plajına doğru bir görünüm.jpg",cap:"Konyaaltı coast · Antalya"},{f:"Ankara from bus station.jpg",cap:"The capital · Ankara"},{f:"Sunset over Bodrum I.jpg",cap:"Sunset over Bodrum"},{f:"Mount Nemrut - East Terrace (4961323529).jpg",cap:"Giant stone heads · Mount Nemrut"}],
   video:{id:"e9mtvvJM0yg",title:"How to travel Turkey | The perfect 14-day guide",by:"Rhett and Claire"},
   cities:[{name:"Ankara",lng:32.85,lat:39.93,capital:true},{name:"Istanbul",lng:28.98,lat:41.01},{name:"Izmir",lng:27.14,lat:38.42},{name:"Bursa",lng:29.06,lat:40.19},{name:"Antalya",lng:30.71,lat:36.90},{name:"Adana",lng:35.32,lat:37.00},{name:"Konya",lng:32.49,lat:37.87},{name:"Gaziantep",lng:37.38,lat:37.07}],
   maps:"https://www.google.com/maps/place/Turkey/@39,35,6z",
   facts:{capital:"Ankara",population:"≈ 85.3 million (2024)",languages:"Turkish (official); Kurdish, Arabic & Zaza also spoken",langCount:"≈ 35 languages spoken in total",independence:"Oct 29, 1923 — Republic proclaimed (from the Ottoman Empire)",government:"Unitary presidential republic",etymology:"From <em>Türk</em> + the Latin suffix <em>-ia</em> — \"land of the Turks.\""},
   people:[{n:"Mustafa Kemal Atatürk",r:"founder & first president of the Republic",img:"Portret_van_de_Turkse_leider_Mustafa_Kemal_Ataturk_(Atatürk_Kemal_Pascha)_(1881-1938)_in_westers,_SFA003017837.jpg"},{n:"Mehmed the Conqueror",r:"sultan who took Constantinople in 1453",img:"Bellini, Gentile - Sultan Mehmet II.jpg"},{n:"Suleiman the Magnificent",r:"longest-reigning Ottoman sultan — golden age",img:"EmperorSuleiman.jpg"},{n:"Rumi (Mevlânâ)",r:"13th-century Sufi poet & mystic",img:"مولانا اثر حسین بهزاد (cropped).jpg"},{n:"Mimar Sinan",r:"master Ottoman architect of the empire",img:"Mimar Sinan, architecte de Soliman le Magnifique.jpg"}],
   music:{n:"Tarkan",r:"pop superstar — the \"Prince of the Bosphorus\"",img:"Tarkan (9).jpg"},
   sports:{n:"Naim Süleymanoğlu",r:"\"Pocket Hercules\" — 3× Olympic weightlifting champion",img:"N Sul.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Turkey"},{label:"Facts & figures",detail:"Wikipedia — \"Turkey\" & related articles",url:"https://en.wikipedia.org/wiki/Turkey"},{label:"Travel film",detail:"YouTube — \"How to travel Turkey\" · Rhett and Claire",url:"https://www.youtube.com/watch?v=e9mtvvJM0yg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Turkey/@39,35,6z"}] },
  TH: { tagline:"Prathet Thai · land of the free, the Kingdom of Siam",
   photos:[{f:"0005574_-_Wat_Phra_Kaew_006.jpg",cap:"Grand Palace · Bangkok"},{f:"Templo_Wat_Arun,_Bangkok,_Tailandia,_2013-08-22,_DD_40.jpg",cap:"Wat Arun · Temple of Dawn"},{f:"Wat_Phra_Kaew_by_Ninara_TSP_edit_crop.jpg",cap:"Wat Phra Kaew · the Emerald Buddha"},{f:"Wat_Phra_That_Doi_Suthep_-_Chiang_Mai.jpg",cap:"Doi Suthep · Chiang Mai"},{f:"KohPhiPhi.JPG",cap:"Phi Phi Islands · Andaman Sea"},{f:"Ayutthaya_World_Heritage_sign.jpg",cap:"Ayutthaya · old capital ruins"},{f:"Railay_Beach_5.jpg",cap:"Railay Beach · Krabi"},{f:"Damnoen_Saduak_Floating_Market_1977_-_panoramio.jpg",cap:"Floating market · Damnoen Saduak"},{f:"Wat_srichum_03.jpg",cap:"Sukhothai · Wat Si Chum"},{f:"Phuket_Aerial.jpg",cap:"Phuket · Andaman coast"}],
   video:{id:"omojFXTxis0",title:"TOP 10 THAILAND (THE BEST OF THAILAND)",by:"Lost LeBlanc"},
   cities:[{name:"Bangkok",lng:100.49,lat:13.75,capital:true},{name:"Nonthaburi",lng:100.52,lat:13.85},{name:"Nakhon Ratchasima",lng:102.10,lat:14.97},{name:"Chiang Mai",lng:98.99,lat:18.79},{name:"Hat Yai",lng:100.47,lat:7.02},{name:"Udon Thani",lng:102.75,lat:17.42},{name:"Pattaya",lng:100.89,lat:12.94},{name:"Phuket",lng:98.39,lat:7.88}],
   maps:"https://www.google.com/maps/place/Thailand/@15,101,6z",
   facts:{capital:"Bangkok (Krung Thep)",population:"≈ 72 million (2024)",languages:"Thai (official) · Isan, Malay, Karen also spoken",langCount:"≈ 70+ languages spoken in total",independence:"Never colonized — kingdom unified 1238 (Sukhothai); constitutional monarchy since 1932",government:"Unitary parliamentary constitutional monarchy",etymology:"From <em>Thai</em> (\"free\") + <em>land</em> — \"land of the free.\" Formerly <em>Siam</em>."},
   people:[{n:"King Ramkhamhaeng",r:"Sukhothai king — created the Thai alphabet",img:"Ram_Khamhaeng_the_Great_(I).jpg"},{n:"King Naresuan",r:"warrior king who freed Siam from Burma",img:"KingNU.jpg"},{n:"King Mongkut (Rama IV)",r:"modernizer who opened Siam to the West",img:"First_King_of_Siam_MET_DP-573-001_(cropped).jpg"},{n:"King Chulalongkorn (Rama V)",r:"abolished slavery — kept Siam independent",img:"Chulalongkorn_LoC.jpg"},{n:"King Bhumibol (Rama IX)",r:"longest-reigning monarch — beloved father of the nation",img:"Aankomst_Koning_Bhumibol_en_Koningin_Sirikit_te_Den_Haag,_Koning_Bhumibol,_Bestanddeelnr_911-6993_(cropped)(2).jpg"}],
   music:{n:"Tata Young",r:"Thailand's biggest international pop crossover star",img:"Tata_young_pimf_2007.JPG"},
   sports:{n:"Ratchanok Intanon",r:"first Thai badminton world champion",img:"Ratchanok_Intanon_Indonesia_Masters_2025.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Thailand"},{label:"Facts & figures",detail:"Wikipedia — \"Thailand\" & related articles",url:"https://en.wikipedia.org/wiki/Thailand"},{label:"Travel film",detail:"YouTube — \"TOP 10 THAILAND\" · Lost LeBlanc",url:"https://www.youtube.com/watch?v=omojFXTxis0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Thailand/@15,101,6z"}] },
  PE: { tagline:"Land of the Incas · where the Andes meet the Amazon",
   photos:[{f:"Machu Picchu, 2023 (012).jpg",cap:"Machu Picchu · the lost Inca citadel"},{f:"Vista Calle Suecia.jpg",cap:"Cusco · ancient Inca capital"},{f:"Sacsayhuamán, Cusco, Perú, 2015-07-31, DD 27.JPG",cap:"Sacsayhuamán · megalithic fortress above Cusco"},{f:"Montañaarcoirisperuabanto.jpg",cap:"Vinicunca · the Rainbow Mountain"},{f:"Miraflores 2023.jpg",cap:"Miraflores · Lima's Pacific cliffs"},{f:"Basílica Catedral Metropolitana de Lima (cropped).jpg",cap:"Lima · the colonial historic center"},{f:"Islas flotantes de los Uros, Lago Titicaca, Perú, 2015-08-01, DD 37.JPG",cap:"Uros floating islands · Lake Titicaca"},{f:"Colca Canyon Puno.jpg",cap:"Colca Canyon · realm of the condor"},{f:"Líneas de Nazca, Nazca, Perú, 2015-07-29, DD 49.JPG",cap:"Nazca Lines · giant desert geoglyphs"},{f:"Laguna Wilcacocha 03.jpg",cap:"Cordillera Blanca · the white Andes"}],
   video:{id:"AHBz5CkQAr8",title:"The Perfect 10 Day Peru Itinerary for First-Timers",by:"Travel Lemming"},
   cities:[{name:"Lima",lng:-77.04,lat:-12.06,capital:true},{name:"Arequipa",lng:-71.54,lat:-16.40},{name:"Trujillo",lng:-79.03,lat:-8.11},{name:"Chiclayo",lng:-79.84,lat:-6.77},{name:"Cusco",lng:-71.98,lat:-13.52},{name:"Piura",lng:-80.63,lat:-5.20},{name:"Iquitos",lng:-73.25,lat:-3.75}],
   maps:"https://www.google.com/maps/place/Peru/@-9.2,-75,5z",
   facts:{capital:"Lima",population:"≈ 34.0 million (2024)",languages:"Spanish, Quechua & Aymara (all official)",langCount:"≈ 90+ languages spoken in total",independence:"July 28, 1821 — from Spain",government:"Unitary presidential republic",etymology:"Possibly from <em>Birú</em>, a local ruler near the Bay of San Miguel."},
   people:[{n:"Pachacuti",r:"Inca emperor — architect of the empire",img:"Brooklyn Museum - Pachacuti, Tenth Inca, 1 of 14 Portraits of Inca Kings (cropped).jpg"},{n:"Atahualpa",r:"last sovereign Inca emperor",img:"Atahuallpa, Inca XIIII From Berlin Ethnologisches Museum, Staatliche Museen, Berlin, Germany.png"},{n:"José de San Martín",r:"liberator who proclaimed independence",img:"José de San Martín (retrato, c.1828).jpg"},{n:"Túpac Amaru II",r:"led the great Andean uprising",img:"TupacAmaruII.jpg"},{n:"César Vallejo",r:"revolutionary poet of the 20th century",img:"Cesar_vallejo_1929.jpg"}],
   music:{n:"Yma Sumac",r:"four-octave soprano — global \"Inca Princess\"",img:"Yma Sumac in Italy.jpg"},
   sports:{n:"Teófilo Cubillas",r:"legendary striker — Peru's greatest footballer",img:"Teófilo Cubillas 1978.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Peru"},{label:"Facts & figures",detail:"Wikipedia — \"Peru\" & related articles",url:"https://en.wikipedia.org/wiki/Peru"},{label:"Travel film",detail:"YouTube — \"The Perfect 10 Day Peru Itinerary\" · Travel Lemming",url:"https://www.youtube.com/watch?v=AHBz5CkQAr8"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Peru/@-9.2,-75,5z"}] },
  IE: { tagline:"The Emerald Isle · wild Atlantic edges & ancient stone",
   photos:[{f:"Cliffs-Of-Moher-OBriens-From-South.JPG",cap:"Cliffs of Moher · County Clare"},{f:"HalfPennyBridge.jpg",cap:"Ha'penny Bridge · Dublin"},{f:"Atlantic_Ocean,_Ring_of_Kerry_(506559)_(27964189752).jpg",cap:"Ring of Kerry · Atlantic coast"},{f:"Ladies_view.jpg",cap:"Ladies View · Killarney National Park"},{f:"The Dingle Peninsula, County Kerry, Ireland as seen from the south 01.jpg",cap:"Dingle Peninsula · County Kerry"},{f:"Connemara Landscape (42075670542).jpg",cap:"Connemara · County Galway"},{f:"Rock_of_Cashel_(49163525453).jpg",cap:"Rock of Cashel · County Tipperary"},{f:"Galway_cathedral.jpg",cap:"Galway Cathedral · the City of Tribes"},{f:"Irelands_history.jpg",cap:"Newgrange · 5,000-year-old passage tomb"},{f:"Islands off the end of the Dingle peninsula.jpg",cap:"Atlantic islands · off the Dingle coast"}],
   video:{id:"qMvFBRKTWfs",title:"10-Day Ireland Road Trip: The Ultimate Travel Guide",by:"Globe Trekker"},
   cities:[{name:"Dublin",lng:-6.26,lat:53.35,capital:true},{name:"Cork",lng:-8.47,lat:51.90},{name:"Limerick",lng:-8.62,lat:52.66},{name:"Galway",lng:-9.05,lat:53.27},{name:"Waterford",lng:-7.11,lat:52.26},{name:"Kilkenny",lng:-7.25,lat:52.65},{name:"Killarney",lng:-9.52,lat:52.06}],
   maps:"https://www.google.com/maps/place/Ireland/@53.4,-8,7z",
   facts:{capital:"Dublin",population:"≈ 5.3 million (2024)",languages:"Irish & English (both official)",langCount:"≈ 5 languages spoken in total",independence:"Dec 6, 1922 — Irish Free State from the UK; republic 1949",government:"Unitary parliamentary republic",etymology:"From <em>Éire</em>, the Irish goddess and name, plus <em>land</em>."},
   people:[{n:"Daniel O'Connell",r:"\"The Liberator\" — won Catholic emancipation",img:"Daniel_O'Connell.png"},{n:"Charles Stewart Parnell",r:"champion of Irish Home Rule",img:"Charles_Stewart_Parnell_-_Brady-Handy.jpg"},{n:"Michael Collins",r:"revolutionary leader & founding statesman",img:"Michael_Collins.jpg"},{n:"Éamon de Valera",r:"independence leader, president & taoiseach",img:"De_Valera_LCCN2016822004_(headshot).jpg"},{n:"W. B. Yeats",r:"poet — Nobel laureate of the Irish revival",img:"William_Butler_Yeats_by_George_Charles_Beresford.jpg"}],
   music:{n:"U2",r:"the globe-conquering Dublin rock band",img:"U2_on_Joshua_Tree_Tour_2017_Brussels_8-1-17.jpg"},
   sports:{n:"Roy Keane",r:"iconic Manchester United & Ireland captain",img:"Roy_keane_2014.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ireland"},{label:"Facts & figures",detail:"Wikipedia — \"Ireland\" & related articles",url:"https://en.wikipedia.org/wiki/Ireland"},{label:"Travel film",detail:"YouTube — \"10-Day Ireland Road Trip\" · Globe Trekker",url:"https://www.youtube.com/watch?v=qMvFBRKTWfs"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ireland/@53.4,-8,7z"}] },
  PL: { tagline:"Serce Europy · a thousand years of grit and grace",
   photos:[{f:"Krakow_Rynek_Glowny_panorama_2.jpg",cap:"Main Market Square · Kraków"},{f:"Krakow_-_Wawel_Cathedral_from_balloon_-_2.jpg",cap:"Wawel Castle · Kraków"},{f:"Warszawa_Stare_Miasto_(dron).jpg",cap:"Old Town · Warsaw"},{f:"Wieliczka-color.jpg",cap:"Wieliczka Salt Mine · carved in salt"},{f:"Zespół_Zamku_Krzyżackiego_MALBORK_01.jpg",cap:"Malbork Castle · the largest brick fortress"},{f:"Tatra_mountains_western_side_2.jpg",cap:"Tatra Mountains · the Polish highlands"},{f:"Zakopane_T58.jpg",cap:"Zakopane · gateway to the peaks"},{f:"Calle_Dlugie_Pobrzeze,_Gdansk,_Polonia,_2013-05-20,_DD_06.jpg",cap:"Long Embankment · Gdańsk"},{f:"Wroclaw-_Most_Grunwaldzki.jpg",cap:"Grunwald Bridge · Wrocław"},{f:"Jezioro_Dadaj_by_RecDronepl.jpg",cap:"Masurian Lakes · Poland's water country"}],
   video:{id:"p1VXDm8Kmdg",title:"9 Days in Poland on a Budget",by:"Morris to See"},
   cities:[{name:"Warsaw",lng:21.01,lat:52.23,capital:true},{name:"Kraków",lng:19.94,lat:50.06},{name:"Łódź",lng:19.46,lat:51.77},{name:"Wrocław",lng:17.04,lat:51.11},{name:"Poznań",lng:16.93,lat:52.41},{name:"Gdańsk",lng:18.65,lat:54.35},{name:"Szczecin",lng:14.55,lat:53.43},{name:"Lublin",lng:22.57,lat:51.25}],
   maps:"https://www.google.com/maps/place/Poland/@52.0,19.0,6z",
   facts:{capital:"Warsaw",population:"≈ 37.0 million (2024)",languages:"Polish (official)",langCount:"≈ 15 languages spoken in total",independence:"Nov 11, 1918 — restored after 123 years of partitions; state founded 966",government:"Unitary parliamentary republic",etymology:"From the <em>Polans</em> tribe — from <em>pole</em>, \"field\" or \"plain.\""},
   people:[{n:"Nicolaus Copernicus",r:"astronomer — placed the Sun at the center",img:"Nikolaus_Kopernikus_MOT.jpg"},{n:"John III Sobieski",r:"king — victor at the 1683 Siege of Vienna",img:"Schultz_John_III_Sobieski.jpg"},{n:"Tadeusz Kościuszko",r:"national hero of Poland and America",img:"Karl_G_Schweikart_-_Tadeusz_Kościuszko_(ÖaL).jpg"},{n:"Józef Piłsudski",r:"statesman — father of restored Poland",img:"Józef_Piłsudski_(-1930).jpg"},{n:"Pope John Paul II",r:"the first Polish pope",img:"ADAMELLO_-_PAPA_-_Giovanni_Paolo_II_-_panoramio_(cropped).jpg"}],
   music:{n:"Frédéric Chopin",r:"the poet of the piano",img:"Frederic_Chopin_photo.jpeg"},
   sports:{n:"Robert Lewandowski",r:"one of the world's greatest strikers",img:"2019147183134_2019-05-27_Fussball_1.FC_Kaiserslautern_vs_FC_Bayern_München_-_Sven_-_1D_X_MK_II_-_0228_-_B70I8527_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Poland"},{label:"Facts & figures",detail:"Wikipedia — \"Poland\" & related articles",url:"https://en.wikipedia.org/wiki/Poland"},{label:"Travel film",detail:"YouTube — \"9 Days in Poland on a Budget\" · Morris to See",url:"https://www.youtube.com/watch?v=p1VXDm8Kmdg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Poland/@52.0,19.0,6z"}] },
  VN: { tagline:"Đất nước hình chữ S — dragons, deltas, and lantern light",
   photos:[{f:"Ha_Long_Bay_in_2019.jpg",cap:"Hạ Long Bay · limestone karsts"},{f:"Hanoi_skyline_with_Ba_Vi_Mountain.jpg",cap:"Hanoi · skyline & Ba Vì Mountain"},{f:"Hoi_An_by_night_(16918).jpg",cap:"Hội An · lantern-lit old town"},{f:"Ho_Chi_Minh_City_panorama_2019_(cropped2).jpg",cap:"Ho Chi Minh City · river skyline"},{f:"Terraced_fields_Sa_Pa_Vietnam.JPG",cap:"Sa Pa · terraced rice fields"},{f:"Thành_phố_Huế_nhìn_từ_trên_cao_(2).jpg",cap:"Huế · imperial capital from above"},{f:"Phongnhakebang6.jpg",cap:"Phong Nha–Kẻ Bàng · cave country"},{f:"Muaxuantamcoc.jpg",cap:"Tràng An · Ninh Bình's karst waterways"},{f:"Cai_Rang_Floating_Market_3.jpg",cap:"Cái Răng · Mekong floating market"},{f:"RiceTerracesVietnam.jpg",cap:"Highland rice terraces at harvest"}],
   video:{id:"th_eS7Xub-s",title:"Our Vietnam Travel Guide 2024 | Hanoi, Hoi An & Ho Chi Minh",by:"Retirement Travelers"},
   cities:[{name:"Hanoi",lng:105.83,lat:21.03,capital:true},{name:"Ho Chi Minh City",lng:106.66,lat:10.82},{name:"Da Nang",lng:108.22,lat:16.05},{name:"Hải Phòng",lng:106.68,lat:20.86},{name:"Cần Thơ",lng:105.78,lat:10.04},{name:"Huế",lng:107.60,lat:16.46},{name:"Nha Trang",lng:109.19,lat:12.24}],
   maps:"https://www.google.com/maps/place/Vietnam/@16,106,6z",
   facts:{capital:"Hanoi",population:"≈ 100.3 million (2024)",languages:"Vietnamese (official)",langCount:"≈ 100+ languages spoken in total",independence:"September 2, 1945 — from France & Japan; reunified 1976",government:"Unitary Marxist–Leninist one-party socialist republic",etymology:"From <em>Việt Nam</em> — the <em>Việt</em> people of the South."},
   people:[{n:"Hồ Chí Minh",r:"founding father & first president",img:"Ho_Chi_Minh_-_1946_Portrait_(cropped).jpg"},{n:"Hai Bà Trưng",r:"the Trưng Sisters — 1st-century rebel queens",img:"Hai_Bà_Trưng_(tranh_Đông_Hồ).jpeg"},{n:"Lý Thái Tổ",r:"emperor who founded Hanoi in 1010",img:"Tượng_Lý_Thái_Tổ_2.jpg"},{n:"Trần Hưng Đạo",r:"general who repelled the Mongol invasions",img:"Tran_Hung_Dao_statue.jpg"},{n:"Võ Nguyên Giáp",r:"general — architect of Điện Biên Phủ",img:"Vo_Nguyen_Giap2.jpg"}],
   music:{n:"Đặng Thái Sơn",r:"first Asian to win the Chopin Piano Competition",img:"Đặng_Thái_Sơn_Hà_Nội_2021.jpg"},
   sports:{n:"Nguyễn Quang Hải",r:"star midfielder of the national football team",img:"Nguyễn_Quang_Hải.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Vietnam"},{label:"Facts & figures",detail:"Wikipedia — \"Vietnam\" & related articles",url:"https://en.wikipedia.org/wiki/Vietnam"},{label:"Travel film",detail:"YouTube — \"Our Vietnam Travel Guide 2024\" · Retirement Travelers",url:"https://www.youtube.com/watch?v=th_eS7Xub-s"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Vietnam/@16,106,6z"}] },
  IR: { tagline:"Persia · 2,500 years of empire, poetry & tilework",
   photos:[{f:"Persépolis, Irán, 2016-09-24, DD 53.jpg",cap:"Persepolis · ceremonial capital of the Achaemenids"},{f:"Naqsh-i Jahan Square, Jan. 2018.jpg",cap:"Naqsh-e Jahan Square · Isfahan"},{f:"Sheikh Lotfallah Esfahan.JPG",cap:"Sheikh Lotfollah Mosque · Isfahan"},{f:"Nasir-al molk -1.jpg",cap:"Nasir al-Mulk Mosque · Shiraz"},{f:"Azadi Tower (29358497718).jpg",cap:"Azadi Tower · Tehran"},{f:"Milad tower2023.jpg",cap:"Milad Tower · Tehran skyline"},{f:"Iran 1343 Yazd (8665215641).jpg",cap:"Yazd · the old desert city"},{f:"Palais du Golestan, Téhéran (5).jpg",cap:"Golestan Palace · Tehran"},{f:"Pasargad Tomb Cyrus3.jpg",cap:"Pasargadae · tomb of Cyrus the Great"},{f:"Dasht-e Kavir.jpg",cap:"Dasht-e Kavir · the Great Salt Desert"}],
   video:{id:"9-ziQwRPI_g",title:"Iran Travel Itinerary for 10 Days | 4K Vlog",by:"Alp Galip Travels"},
   cities:[{name:"Tehran",lng:51.39,lat:35.69,capital:true},{name:"Mashhad",lng:59.54,lat:36.33},{name:"Isfahan",lng:51.67,lat:32.67},{name:"Shiraz",lng:52.54,lat:29.61},{name:"Tabriz",lng:46.30,lat:38.07},{name:"Karaj",lng:50.97,lat:35.83},{name:"Yazd",lng:54.34,lat:31.88},{name:"Qom",lng:50.88,lat:34.64}],
   maps:"https://www.google.com/maps/place/Iran/@32,53,5z",
   facts:{capital:"Tehran",population:"≈ 89 million (2024)",languages:"Persian (Farsi, official); Azerbaijani, Kurdish & others",langCount:"≈ 75+ languages spoken in total",independence:"continuous statehood since 550 BC (Achaemenid Empire); Islamic Republic since 1979",government:"Unitary Islamic republic",etymology:"From <em>Iran</em> — \"land of the <em>Aryans</em>\"; known abroad as <em>Persia</em> until 1935."},
   people:[{n:"Cyrus the Great",r:"founder of the Achaemenid Empire, 6th c. BC",img:"Cyrus II (The Great) (cropped).jpg"},{n:"Darius the Great",r:"king who built Persepolis & the royal road",img:"Darius I.jpg"},{n:"Ferdowsi",r:"poet of the Shahnameh, Iran's national epic",img:"Imaginary depiction of the poet Firdausi. Folio from a Khavarannama (The Book of the East) of ibn Husam al-Din, 1476-1486 (cropped).jpg"},{n:"Avicenna (Ibn Sina)",r:"physician-philosopher, father of early medicine",img:"Avicenna Bust, left profile (cropped).jpg"},{n:"Omar Khayyam",r:"poet, mathematician & astronomer",img:"Hakim Omar Khayam - panoramio.jpg"}],
   music:{n:"Mohammad-Reza Shajarian",r:"the revered maestro of Persian classical song",img:"Mohammad-Reza Shajarian press conference - 26 December 2007 (8 8610050604 L600).jpg"},
   sports:{n:"Gholamreza Takhti",r:"Olympic wrestling champion & national hero",img:"Portrait of Gholamreza Takhti.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Iran"},{label:"Facts & figures",detail:"Wikipedia — \"Iran\" & related articles",url:"https://en.wikipedia.org/wiki/Iran"},{label:"Travel film",detail:"YouTube — \"Iran Travel Itinerary for 10 Days\" · Alp Galip Travels",url:"https://www.youtube.com/watch?v=9-ziQwRPI_g"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Iran/@32,53,5z"}] },
  IL: { tagline:"Land of milk and honey · where three faiths meet the Mediterranean",
   photos:[{f:"2014-06_East_Jerusalem_090_(14936890061).jpg",cap:"Old City skyline · Jerusalem"},{f:"Westernwall2.jpg",cap:"The Western Wall · Jerusalem"},{f:"Jerusalem-2013(2)-Temple_Mount-Dome_of_the_Rock_(SE_exposure).jpg",cap:"Dome of the Rock · Temple Mount"},{f:"Sarona_CBD_01_(cropped).jpg",cap:"Skyline · Tel Aviv"},{f:"Tel_Aviv_Promenade_panoramics.jpg",cap:"Beachfront promenade · Tel Aviv"},{f:"Dead_Sea_beach_00.JPG",cap:"The Dead Sea · lowest point on Earth"},{f:"Israel-2013-Aerial_21-Masada.jpg",cap:"Masada fortress · Judaean Desert"},{f:"The_Bahai_Temple_in_Haifa_Israel.jpg",cap:"Bahá'í Gardens · Haifa"},{f:"Kinneret_cropped.jpg",cap:"Sea of Galilee · the Kinneret"},{f:"MakhteshRamonMar262022_01.jpg",cap:"Ramon Crater · the Negev"}],
   video:{id:"EN476JfUr2s",title:"Israel Travel Guide: 10 Must See Destinations",by:"RMV Travel"},
   cities:[{name:"Jerusalem",lng:35.22,lat:31.78,capital:true},{name:"Tel Aviv",lng:34.78,lat:32.08},{name:"Haifa",lng:34.99,lat:32.79},{name:"Rishon LeZion",lng:34.79,lat:31.96},{name:"Petah Tikva",lng:34.89,lat:32.09},{name:"Ashdod",lng:34.65,lat:31.80},{name:"Beersheba",lng:34.79,lat:31.25},{name:"Netanya",lng:34.86,lat:32.33}],
   maps:"https://www.google.com/maps/place/Israel/@31.4,35,7z",
   facts:{capital:"Jerusalem (declared); Tel Aviv is the economic hub",population:"≈ 9.9 million (2024)",languages:"Hebrew (official); Arabic (special status); English widely used",langCount:"≈ 35 languages spoken in total",independence:"May 14, 1948 — from British Mandate rule",government:"Unitary parliamentary republic",etymology:"From <em>Yisrael</em> — a biblical name meaning \"one who <em>struggles with God</em>.\""},
   people:[{n:"Theodor Herzl",r:"visionary father of modern political Zionism",img:"Theodor_Herzl_(3x4_cropped).jpg"},{n:"David Ben-Gurion",r:"founding father & first prime minister",img:"David_Ben-Gurion_(D597-087).jpg"},{n:"Chaim Weizmann",r:"chemist & first president of Israel",img:"Flickr_-_Government_Press_Office_(GPO)_-_President_Chaim_Weizmann_(retouched).jpg"},{n:"Golda Meir",r:"fourth prime minister of Israel",img:"Golda_Meir_03265u-2_(cropped).jpg"},{n:"Yitzhak Rabin",r:"prime minister & Nobel Peace laureate",img:"Yitzhak_Rabin_1994_Portrait_(3x4_cropped).jpg"}],
   music:{n:"Ofra Haza",r:"the \"Madonna of the East\" — global Yemenite-Israeli star",img:"Ofra_Haza_1981_(עפרה_חזה_1981).jpg"},
   sports:{n:"Artem Dolgopyat",r:"2× Olympic gold gymnast (2020, 2024)",img:"Artem_Dolgopyat_Honored_at_Beit_HaNassi,_in_Jerusalem_(5136)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Israel"},{label:"Facts & figures",detail:"Wikipedia — \"Israel\" & related articles",url:"https://en.wikipedia.org/wiki/Israel"},{label:"Travel film",detail:"YouTube — \"Israel Travel Guide: 10 Must See Destinations\" · RMV Travel",url:"https://www.youtube.com/watch?v=EN476JfUr2s"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Israel/@31.4,35,7z"}] },
  MA: { tagline:"Al-Maghrib · where the Atlas meets the Sahara and the sea",
   photos:[{f:"Djemaa_el_Fna.jpg",cap:"Jemaa el-Fnaa · Marrakech"},{f:"Chefchaouen_(52189357475).jpg",cap:"The blue city · Chefchaouen"},{f:"Fes_Bab_Bou_Jeloud_2011.jpg",cap:"Bab Bou Jeloud gate · Fes medina"},{f:"Fez_Chouara_Tannery_(54238811661).jpg",cap:"Chouara tannery · Fes"},{f:"Merzouga_Dunes_2011.jpg",cap:"Erg Chebbi dunes · Merzouga"},{f:"The_Open_Area_of_Hassan_II_Mosque_-_Casablanca_Morocco.jpg",cap:"Hassan II Mosque · Casablanca"},{f:"AïtBenhaddou_Morocco_2.jpg",cap:"Ksar of Aït Benhaddou"},{f:"Kasbah_Oudayas_exterior.jpg",cap:"Kasbah of the Udayas · Rabat"},{f:"Plateau_Yagour,_Agdal,_Morocco.jpg",cap:"High Atlas Mountains"},{f:"Morocco_-_Essaouira_Part_2_(31679848385).jpg",cap:"Atlantic ramparts · Essaouira"}],
   video:{id:"JUx2hF1spqo",title:"16 Days in Morocco | Steal My Travel Itinerary",by:"Anela Malik"},
   cities:[{name:"Rabat",lng:-6.83,lat:34.02,capital:true},{name:"Casablanca",lng:-7.59,lat:33.57},{name:"Marrakech",lng:-7.99,lat:31.63},{name:"Fes",lng:-5.00,lat:34.04},{name:"Tangier",lng:-5.80,lat:35.77},{name:"Agadir",lng:-9.60,lat:30.42},{name:"Meknes",lng:-5.55,lat:33.90},{name:"Chefchaouen",lng:-5.27,lat:35.17}],
   maps:"https://www.google.com/maps/place/Morocco/@31.8,-7,6z",
   facts:{capital:"Rabat",population:"≈ 38.1 million (2024)",languages:"Arabic & Berber/Tamazight (official); French widely used",langCount:"≈ 12 languages spoken in total",independence:"March 2, 1956 — from France (and Spain)",government:"Unitary parliamentary constitutional monarchy",etymology:"English <em>Morocco</em> comes from <em>Marrakesh</em>, a former capital; the Arabic name <em>al-Maghrib</em> means \"the West.\""},
   people:[{n:"Ibn Battuta",r:"14th-century explorer — history's great traveler",img:"Handmade_oil_painting_reproduction_of_Ibn_Battuta_in_Egypt,_a_painting_by_Hippolyte_Leon_Benett..jpg"},{n:"Yusuf ibn Tashfin",r:"Almoravid ruler — founder of Marrakesh",img:"Yusuf_Ben_Tasfin_dinar_22562.jpg"},{n:"Ahmad al-Mansur",r:"Saadian sultan — golden-age empire-builder",img:"Ahmad_al-Mansur_by_André_Thevet.png"},{n:"Mohammed V",r:"sultan & king — father of independence",img:"Mohammed_V_(1953).jpg"},{n:"Hassan II",r:"king who shaped modern Morocco (1961–99)",img:"Hassan_II_of_Morocco_official_portrait.jpg"}],
   music:{n:"RedOne",r:"superstar producer behind global pop hits",img:"RedOne_2017_press_image.jpg"},
   sports:{n:"Hicham El Guerrouj",r:"the \"King of the Mile\" — 2× Olympic gold",img:"Hicham_El_Guerrouj_cropped.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Morocco"},{label:"Facts & figures",detail:"Wikipedia — \"Morocco\" & related articles",url:"https://en.wikipedia.org/wiki/Morocco"},{label:"Travel film",detail:"YouTube — \"16 Days in Morocco\" · Anela Malik",url:"https://www.youtube.com/watch?v=JUx2hF1spqo"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Morocco/@31.8,-7,6z"}] },
  ET: { tagline:"The roof of Africa · ancient, uncolonized, unforgettable",
   photos:[{f:"Lalibela,_san_giorgio,_esterno_24.jpg",cap:"Church of St. George · Lalibela"},{f:"Bwahit,_view_onto_Kidis_Yared_4453m.JPG",cap:"Simien Mountains · Bwahit peak"},{f:"Ethiopia_-_dry_landscape_in_the_Danakil_Depression.jpg",cap:"Danakil Depression · the Afar desert"},{f:"ET_Gondar_asv2018-02_img18_Fasil_Ghebbi.jpg",cap:"Fasil Ghebbi · Gondar's royal castles"},{f:"Blue_Nile_Falls-03,_by_CT_Snow.jpg",cap:"Blue Nile Falls · Tis Issat"},{f:"Addis_in_night.jpg",cap:"Addis Ababa · after dark"},{f:"ET_Amhara_asv2018-02_img097_Lake_Tana_at_Bahir_Dar.jpg",cap:"Lake Tana · source of the Blue Nile"},{f:"Dassanech_Tribe,_Omo_Valley,_Ethiopia_(6840885950).jpg",cap:"Dassanech people · Omo Valley"},{f:"Harenna_Forest_(16139095228).jpg",cap:"Harenna Forest · Bale Mountains"},{f:"Erta_Ale.jpg",cap:"Erta Ale · a lava-lake volcano"}],
   video:{id:"2xW9mTStyhM",title:"Journey Through Ethiopia - Africa Travel Documentary",by:"Stef Hoffer"},
   cities:[{name:"Addis Ababa",lng:38.74,lat:9.03,capital:true},{name:"Dire Dawa",lng:41.87,lat:9.59},{name:"Mekelle",lng:39.48,lat:13.50},{name:"Gondar",lng:37.47,lat:12.61},{name:"Bahir Dar",lng:37.39,lat:11.59},{name:"Hawassa",lng:38.48,lat:7.06},{name:"Adama",lng:39.27,lat:8.54}],
   maps:"https://www.google.com/maps/place/Ethiopia/@9,40,6z",
   facts:{capital:"Addis Ababa",population:"≈ 128 million (2024)",languages:"Amharic (federal working language); Oromo, Somali, Tigrinya + 80 more",langCount:"≈ 90+ languages spoken in total",independence:"Ancient statehood; never colonized — briefly occupied by Italy 1936–41",government:"Federal parliamentary republic",etymology:"From Greek <em>Aithiopia</em> — \"land of <em>burnt faces</em>.\""},
   people:[{n:"Haile Selassie",r:"last emperor — revered as messiah by Rastafari",img:"Haile_Selassie_in_full_dress_(3x4_cropped).jpg"},{n:"Menelik II",r:"crushed Italy at Adwa in 1896",img:"Emperor_Menelik_II.png"},{n:"Tewodros II",r:"emperor who began Ethiopia's modern unification",img:"Téwodros_II_-_2.jpg"},{n:"Empress Taytu Betul",r:"co-ruler & founder of Addis Ababa",img:"Taytu_Betul.jpg"},{n:"Ezana of Axum",r:"4th-century king who made Christianity official",img:"AXUM._Ezanas._Circa_330-360.jpg"}],
   music:{n:"Mulatu Astatke",r:"the father of Ethio-jazz",img:"Mulatu_Astatke_Cosmopolite_2017_(221840).jpg"},
   sports:{n:"Abebe Bikila",r:"won the 1960 Olympic marathon barefoot",img:"Abebe_Bikila_1968_(b_retouched).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ethiopia"},{label:"Facts & figures",detail:"Wikipedia — \"Ethiopia\" & related articles",url:"https://en.wikipedia.org/wiki/Ethiopia"},{label:"Travel film",detail:"YouTube — \"Journey Through Ethiopia\" · Stef Hoffer",url:"https://www.youtube.com/watch?v=2xW9mTStyhM"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ethiopia/@9,40,6z"}] },
  KE: { tagline:"Where the savanna runs wild — cradle of the safari",
   photos:[{f:"Masai_Mara_at_Sunset.jpg",cap:"Maasai Mara · golden-hour savanna"},{f:"Lion at Maasai Mara National Reserve Kenya.jpg",cap:"Big cats of the Mara"},{f:"Wildebeest herd on hillside, Maasai Mara, Kenya.jpg",cap:"The Great Migration · Maasai Mara"},{f:"MtKenya.jpg",cap:"Mount Kenya · the nation's namesake peak"},{f:"Amboseli National Park and Mt. Kilimanjaro.jpg",cap:"Amboseli · elephants beneath Kilimanjaro"},{f:"Nairobi_skyline_from_Gem_Hotel.jpg",cap:"Nairobi · the green city skyline"},{f:"Lake Nakuru National Park 02 - Lesser Flamingo (Phoeniconaias minor).jpg",cap:"Lake Nakuru · rivers of flamingos"},{f:"Diani_Beach_Ukunda.jpg",cap:"Diani Beach · Indian Ocean white sand"},{f:"Hell's_Gate,_Kenya.jpg",cap:"Hell's Gate · Rift Valley gorges"},{f:"Lamu_Old_Town.jpg",cap:"Lamu · Swahili stone-town lanes"}],
   video:{id:"xTYnb78h4G4",title:"This Kenya Safari Will Blow Your Mind (Masai Mara)",by:"Ella McKendrick"},
   cities:[{name:"Nairobi",lng:36.82,lat:-1.29,capital:true},{name:"Mombasa",lng:39.67,lat:-4.05},{name:"Kisumu",lng:34.77,lat:-0.08},{name:"Nakuru",lng:36.07,lat:-0.30},{name:"Eldoret",lng:35.28,lat:0.52},{name:"Thika",lng:37.08,lat:-1.05},{name:"Malindi",lng:40.13,lat:-3.22}],
   maps:"https://www.google.com/maps/place/Kenya/@0.2,37.9,6z",
   facts:{capital:"Nairobi",population:"≈ 56 million (2024)",languages:"Swahili & English (official)",langCount:"≈ 68 languages spoken in total",independence:"December 12, 1963 — from the United Kingdom",government:"Unitary presidential republic",etymology:"From <em>Mount Kenya</em> — the Kikuyu/Kamba name <em>Kĩrĩnyaga</em>, \"God's resting place.\""},
   people:[{n:"Jomo Kenyatta",r:"founding father — first president of Kenya",img:"Jomo_Kenyatta_(cropped)_in_June_15th,_1966.jpg"},{n:"Wangari Maathai",r:"Nobel Peace laureate — Green Belt founder",img:"Wangari_Maathai_in_2001.jpg"},{n:"Dedan Kimathi",r:"Mau Mau leader in the independence uprising",img:"Dedan_Kimathi_Waciuri_-_Veteran_Mau_Mau_Leader_in_Kenya.jpg"},{n:"Tom Mboya",r:"pan-Africanist statesman & independence architect",img:"Tom_Mboya_1962_(cropped).jpg"},{n:"Daniel arap Moi",r:"longtime president — ruled 1978 to 2002",img:"Daniel_arap_Moi_1979b.jpg"}],
   music:{n:"Sauti Sol",r:"Afro-pop band — Kenya's biggest global act",img:"Sauti-Sol.jpg"},
   sports:{n:"Eliud Kipchoge",r:"marathon GOAT — first to run under 2 hours",img:"Eliud_Kipchoge_in_Berlin_-_2015_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Kenya"},{label:"Facts & figures",detail:"Wikipedia — \"Kenya\" & related articles",url:"https://en.wikipedia.org/wiki/Kenya"},{label:"Travel film",detail:"YouTube — \"This Kenya Safari Will Blow Your Mind\" · Ella McKendrick",url:"https://www.youtube.com/watch?v=xTYnb78h4G4"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Kenya/@0.2,37.9,6z"}] },
  UA: { tagline:"Kraina — where golden domes meet Carpathian peaks",
   photos:[{f:"80-391-0151_Kyiv_St.Sophia's_Cathedral_RB_18_2_(cropped).jpg",cap:"St. Sophia's Cathedral · Kyiv"},{f:"Golden_Gate_Kiev_2018_G1.jpg",cap:"The Golden Gate · Kyiv"},{f:"Лавра.jpg",cap:"Kyiv Pechersk Lavra · the Monastery of the Caves"},{f:"Латинський_кафедральний_собор_(Львів)_16.jpg",cap:"Old Town rooftops · Lviv"},{f:"Потьомкінські_сходи_11.jpg",cap:"The Potemkin Stairs · Odesa"},{f:"Зимова_фортеця.jpg",cap:"Kamianets-Podilskyi Castle in winter"},{f:"73-250-0001_Khotyn_Fortress_RB_18.jpg",cap:"Khotyn Fortress on the Dniester"},{f:"Резиденція_митрополитів_Буковини_і_Далмації_5.jpg",cap:"Chernivtsi University · a UNESCO residence"},{f:"Tunnel of Love (15899873014).jpg",cap:"The Tunnel of Love · Klevan"},{f:"Ранкові_промені_на_Синевирі.jpg",cap:"Dawn over Lake Synevyr · the Carpathians"}],
   video:{id:"lAyWhJ6tr9E",title:"Top 10 Places To Visit In Ukraine - 4K Travel Guide",by:"Ryan Shirley"},
   cities:[{name:"Kyiv",lng:30.52,lat:50.45,capital:true},{name:"Kharkiv",lng:36.23,lat:49.99},{name:"Odesa",lng:30.73,lat:46.48},{name:"Dnipro",lng:35.05,lat:48.46},{name:"Lviv",lng:24.03,lat:49.84},{name:"Zaporizhzhia",lng:35.14,lat:47.84},{name:"Vinnytsia",lng:28.47,lat:49.23}],
   maps:"https://www.google.com/maps/place/Ukraine/@48.4,31,6z",
   facts:{capital:"Kyiv",population:"≈ 38 million (2024, est.)",languages:"Ukrainian (official); Russian & minority languages widely spoken",langCount:"≈ 40+ languages spoken in total",independence:"Aug 24, 1991 — from the Soviet Union",government:"Unitary semi-presidential republic",etymology:"From the Slavic <em>ukraina</em> — \"borderland\" or \"region, country.\""},
   people:[{n:"Volodymyr the Great",r:"grand prince who Christianized Kyivan Rus'",img:"Coin_of_Vladimir_the_Great.JPG"},{n:"Bohdan Khmelnytsky",r:"Cossack hetman who founded a Ukrainian state",img:"Bohdan_Khmelnytsky_(Portrait,_sec._half_17th_century,_Chernihiv_Historical_Museum)_(cropped).jpg"},{n:"Taras Shevchenko",r:"national poet — father of modern Ukrainian literature",img:"Т._Г._Шевченко._Квітень_1859.jpg"},{n:"Lesya Ukrainka",r:"pioneering poet & playwright",img:"Lesya_Ukrainka_portrait.jpg"},{n:"Ivan Mazepa",r:"Cossack hetman & patron of the arts",img:"Iwan_Mazepa_crop.jpg"}],
   music:{n:"Jamala",r:"singer who won Eurovision 2016 with \"1944\"",img:"Jamala_Volia_Space_2024_(cropped).png"},
   sports:{n:"Andriy Shevchenko",r:"Ballon d'Or striker — Ukraine's football icon",img:"Андрій_Шевченко_2024_(cropped).png"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Ukraine"},{label:"Facts & figures",detail:"Wikipedia — \"Ukraine\" & related articles",url:"https://en.wikipedia.org/wiki/Ukraine"},{label:"Travel film",detail:"YouTube — \"Top 10 Places To Visit In Ukraine\" · Ryan Shirley",url:"https://www.youtube.com/watch?v=lAyWhJ6tr9E"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Ukraine/@48.4,31,6z"}] },
  SE: { tagline:"Sverige · midnight sun, deep forests, and pop perfected",
   photos:[{f:"Gamla_stan_September_2014_01.jpg",cap:"Gamla Stan · Stockholm's old town"},{f:"Göteborg_2503_stitch_(28573994096).jpg",cap:"Gothenburg · the west-coast harbor city"},{f:"Abisko_overview.JPG",cap:"Abisko · aurora country in Lapland"},{f:"Church_of_Kiruna_2011.jpg",cap:"Kiruna · the Arctic town"},{f:"Öland_panorama_mot_Östersjön_01.JPG",cap:"Öland · Baltic coast horizons"},{f:"1285Kalmar_slott.jpg",cap:"Kalmar Castle · Renaissance stronghold"},{f:"0522Visby_domkyrka.jpg",cap:"Visby · medieval Gotland"},{f:"Swedish_Summer_Dream_-_Flickr_-_northofsweden.jpg",cap:"Red cottages · lakeside summer"},{f:"ICEHOTEL_Main_Hall_(2014)_by_Alessandro_Falca_&_AnnaSofia_Mååg.jpg",cap:"Icehotel · rebuilt every winter in Jukkasjärvi"},{f:"Pierikpakte_in_Sarek.jpg",cap:"Sarek · roadless wilderness"}],
   video:{id:"aFI-utCFov0",title:"Sweden Travel Guide | 6 Best Places to Visit",by:"Travel Navigator"},
   cities:[{name:"Stockholm",lng:18.07,lat:59.33,capital:true},{name:"Gothenburg",lng:11.97,lat:57.71},{name:"Malmö",lng:13.00,lat:55.61},{name:"Uppsala",lng:17.64,lat:59.86},{name:"Västerås",lng:16.55,lat:59.61},{name:"Örebro",lng:15.21,lat:59.27},{name:"Linköping",lng:15.62,lat:58.41}],
   maps:"https://www.google.com/maps/place/Sweden/@62.2,17.6,4z",
   facts:{capital:"Stockholm",population:"≈ 10.6 million (2024)",languages:"Swedish (official); 5 recognized minority languages",langCount:"≈ 15 languages spoken in total",independence:"Consolidated as a kingdom in the Middle Ages; left the Kalmar Union June 6, 1523 (National Day)",government:"Unitary parliamentary constitutional monarchy",etymology:"From the <em>Svear</em> (Swedes) — \"land of the Swedes.\""},
   people:[{n:"Gustav Vasa",r:"founding king — broke the Kalmar Union",img:"Gustav_Vasa.jpg"},{n:"Gustavus Adolphus",r:"\"Lion of the North\" — warrior king",img:"Attributed_to_Jacob_Hoefnagel_-_Gustavus_Adolphus,_King_of_Sweden_1611-1632_-_Google_Art_Project.jpg"},{n:"Carl Linnaeus",r:"father of modern taxonomy",img:"Carolus_Linnaeus_(cleaned_up_version).jpg"},{n:"Alfred Nobel",r:"chemist — founder of the Nobel Prizes",img:"Alfred_Nobel3.jpg"},{n:"Raoul Wallenberg",r:"diplomat who saved thousands from the Holocaust",img:"Raoul_Wallenberg.jpg"}],
   music:{n:"ABBA",r:"the best-selling Swedish act of all time",img:"ABBA_-_TopPop_1974_5.png"},
   sports:{n:"Zlatan Ibrahimović",r:"prolific striker — Sweden's football icon",img:"Zlatan_Ibrahimović_June_2018.jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Sweden"},{label:"Facts & figures",detail:"Wikipedia — \"Sweden\" & related articles",url:"https://en.wikipedia.org/wiki/Sweden"},{label:"Travel film",detail:"YouTube — \"Sweden Travel Guide\" · Travel Navigator",url:"https://www.youtube.com/watch?v=aFI-utCFov0"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Sweden/@62.2,17.6,4z"}] },
  CH: { tagline:"Confoederatio Helvetica · four languages, one alpine heart",
   photos:[{f:"Matterhorn_from_Domhütte_-_2.jpg",cap:"The Matterhorn · above Zermatt"},{f:"1_zermatt_evening_2022.jpg",cap:"Zermatt · car-free alpine village"},{f:"Jungfrau03.jpg",cap:"The Jungfrau · Bernese Alps"},{f:"North_face.jpg",cap:"The Eiger's north face"},{f:"1_lauterbrunnen_valley_wengen_2022.jpg",cap:"Lauterbrunnen · the valley of 72 waterfalls"},{f:"001_Chateau_de_Chillon_and_Dents_du_Midi_Photo_by_Giles_Laurent.jpg",cap:"Château de Chillon · Lake Geneva"},{f:"Kapellbruecke.JPG",cap:"Chapel Bridge · Lucerne"},{f:"Bundeshaus_Bern_2009,_Flooffy.jpg",cap:"Federal Palace · Bern old town"},{f:"Goldswil-Viadukt_Panorama_mit_Interlaken_im_Hintergrund_2.jpg",cap:"Interlaken · between two lakes"},{f:"20190725_Oeschinensee-Panorama,_Kandersteg_(06540-42_stitch).jpg",cap:"Lake Oeschinen · a turquoise mountain lake"}],
   video:{id:"z4lkEJ7qpnI",title:"Switzerland Travel · A 6-Day Road Trip Itinerary",by:"World Wild Hearts"},
   cities:[{name:"Bern",lng:7.447,lat:46.948,capital:true},{name:"Zürich",lng:8.541,lat:47.377},{name:"Geneva",lng:6.147,lat:46.202},{name:"Basel",lng:7.591,lat:47.555},{name:"Lausanne",lng:6.633,lat:46.520},{name:"Lucerne",lng:8.300,lat:47.050},{name:"St. Gallen",lng:9.371,lat:47.424},{name:"Lugano",lng:8.953,lat:46.005}],
   maps:"https://www.google.com/maps/place/Switzerland/@46.8,8.2,7z",
   facts:{capital:"Bern (the \"federal city\")",population:"≈ 8.9 million (2024)",languages:"German, French, Italian & Romansh (all official)",langCount:"≈ 25 languages spoken in total",independence:"Founded 1291 (Federal Charter); independence recognized 1648 (Peace of Westphalia)",government:"Federal semi-direct democratic republic",etymology:"From the canton of <em>Schwyz</em>; the Latin name <em>Confoederatio Helvetica</em> gives the code <em>CH</em>."},
   people:[{n:"Henri Dunant",r:"founder of the Red Cross — first Nobel Peace Prize",img:"Henry_Dunant-young.jpg"},{n:"William Tell",r:"legendary folk hero of Swiss independence",img:"2019 Tell Monument Statue (Telldenkmal) Altdorf Uri Switzerland Ank Kumar Infosys Limited 03.jpg"},{n:"Le Corbusier",r:"pioneer of modern architecture",img:"Le_Corbusier_(1964).jpg"},{n:"Leonhard Euler",r:"one of history's greatest mathematicians",img:"Leonhard_Euler_-_Jakob_Emanuel_Handmann_(Kunstmuseum_Basel).jpg"},{n:"Carl Jung",r:"founder of analytical psychology",img:"Carl Gustav Jung portrait.jpg"}],
   music:{n:"DJ BoBo",r:"globe-touring Eurodance star",img:"DJ_Bobo,_Ergo_Arena,_02.11.2024_39.jpg"},
   sports:{n:"Roger Federer",r:"20-time Grand Slam tennis champion",img:"Roger_Federer_2015_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Switzerland"},{label:"Facts & figures",detail:"Wikipedia — \"Switzerland\" & related articles",url:"https://en.wikipedia.org/wiki/Switzerland"},{label:"Travel film",detail:"YouTube — \"Switzerland Travel · 6-Day Road Trip\" · World Wild Hearts",url:"https://www.youtube.com/watch?v=z4lkEJ7qpnI"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Switzerland/@46.8,8.2,7z"}] },
  PH: { tagline:"Perlas ng Silangan · 7,641 islands where the Pacific meets the tropics",
   photos:[{f:"El_Nido_Bay_December_2018.jpg",cap:"El Nido limestone karsts · Palawan"},{f:"Banaue-terrace.JPG",cap:"Banaue Rice Terraces · Ifugao"},{f:"Chocolate_Hills_Bohol.JPG",cap:"The Chocolate Hills · Bohol"},{f:"Cityscape_of_Manila,_2025_(01).jpg",cap:"Manila skyline"},{f:"Boracay_White_Beach.png",cap:"White Beach · Boracay"},{f:"Mount_Mayon_Cagsawa_field_view_close-up_(Busay,_Daraga,_Albay;_04-21-2023).jpg",cap:"Mayon Volcano over Cagsawa · Albay"},{f:"Cebu_City_2026_skyline1.jpg",cap:"Cebu City skyline"},{f:"Allan_Jay_Quesada_-_Vigan_Cathedral_001.jpg",cap:"Spanish-colonial Vigan · Ilocos Sur"},{f:"Kayangan_Lake,_Coron_-_Palawan.jpg",cap:"Kayangan Lake · Coron, Palawan"},{f:"Coron_skyline_Tapyas_(Coron,_Palwan;_03-16-2024).jpg",cap:"Coron town from Mt. Tapyas · Palawan"}],
   video:{id:"pOvVsbN9DZg",title:"The Philippines · Cinematic Travel Film 2024",by:"Michael2160p"},
   cities:[{name:"Manila",lng:120.98,lat:14.60,capital:true},{name:"Quezon City",lng:121.04,lat:14.68},{name:"Davao",lng:125.61,lat:7.19},{name:"Cebu City",lng:123.89,lat:10.32},{name:"Zamboanga",lng:122.08,lat:6.92},{name:"Cagayan de Oro",lng:124.65,lat:8.48},{name:"Iloilo",lng:122.57,lat:10.72},{name:"Baguio",lng:120.59,lat:16.41}],
   maps:"https://www.google.com/maps/place/Philippines/@12.9,121.8,5z",
   facts:{capital:"Manila",population:"≈ 114 million (2024)",languages:"Filipino & English (official)",langCount:"≈ 180+ languages spoken in total",independence:"June 12, 1898 — declared from Spain; July 4, 1946 — from the US",government:"Unitary presidential republic",etymology:"Named after King <em>Philip II of Spain</em> — <em>Las Islas Filipinas</em>."},
   people:[{n:"José Rizal",r:"national hero — writer whose novels sparked the revolution",img:"Jose_Rizal_full.jpg"},{n:"Andrés Bonifacio",r:"founder of the Katipunan — father of the revolution",img:"Andrés_Bonifacio_photo_(cropped).jpg"},{n:"Emilio Aguinaldo",r:"first president of the Philippines",img:"Emilio_Aguinaldo_ca._1919_(Restored).jpg"},{n:"Apolinario Mabini",r:"the \"Brains of the Revolution\"",img:"Apolinario_Mabini.jpg"},{n:"Melchora Aquino",r:"\"Tandang Sora\" — mother of the revolution",img:"Melchora_Aquino_de_Ramos.jpg"}],
   music:{n:"Lea Salonga",r:"Tony-winning voice of Broadway & Disney",img:"LeaSalonga-byPhilipRomano_(cropped).jpg"},
   sports:{n:"Manny Pacquiao",r:"8-division world boxing champion",img:"Former_senator_Manny_Pacquiao_speaks_in_event_(10-01-2025)_(cropped).jpg"},
   sources:[{label:"Photos",detail:"Wikimedia Commons — CC-licensed, individual contributors",url:"https://commons.wikimedia.org/wiki/Category:Philippines"},{label:"Facts & figures",detail:"Wikipedia — \"Philippines\" & related articles",url:"https://en.wikipedia.org/wiki/Philippines"},{label:"Travel film",detail:"YouTube — \"The Philippines · Cinematic Travel Film 2024\" · Michael2160p",url:"https://www.youtube.com/watch?v=pOvVsbN9DZg"},{label:"Map outline",detail:"Natural Earth via world-atlas — public domain",url:"https://www.naturalearthdata.com/"},{label:"Location",detail:"Google Maps",url:"https://www.google.com/maps/place/Philippines/@12.9,121.8,5z"}] },
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
        <div class="info-mapfoot">
          <a class="info-maps-link" href="${d.maps}" target="_blank" rel="noopener">📍 Open in Google Maps</a>
          <div class="info-insets" id="info-insets"></div>
        </div>
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
        <a class="info-starrow" href="${wikiLink(d.music.n)}" target="_blank" rel="noopener" title="${esc(d.music.n)} — read on Wikipedia">${faceImg(d.music.img, d.music.n)}<div><div class="info-star">${esc(d.music.n)} <span class="info-face__ext" aria-hidden="true">↗</span></div><div class="info-star__r">${esc(d.music.r)}</div></div></a>
      </div>
      <div class="info-card">
        <h3>🏅 Most famous sports figure</h3>
        <a class="info-starrow" href="${wikiLink(d.sports.n)}" target="_blank" rel="noopener" title="${esc(d.sports.n)} — read on Wikipedia">${faceImg(d.sports.img, d.sports.n)}<div><div class="info-star">${esc(d.sports.n)} <span class="info-face__ext" aria-hidden="true">↗</span></div><div class="info-star__r">${esc(d.sports.r)}</div></div></a>
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
