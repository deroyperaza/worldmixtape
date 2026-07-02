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
      body = `<button class="acct__btn acct__in" id="acct-in"><span class="acct__g" aria-hidden="true">G</span> Sign in with Google</button><small class="acct__note">save across devices + see counts</small>`;
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
  activeCode = null; currentEra = null; currentGenre = null;
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
  if (shuffled) for (let i = list.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  const curId = (qIndex >= 0 && queue[qIndex]) ? queue[qIndex].trackId : null;  // keep the playing track highlighted across reorders
  queue = list;
  qIndex = curId != null ? list.findIndex(t => t.trackId === curId) : -1;
  const ctrls = inner.querySelector("#fav-ctrls");
  if (ctrls){
    ctrls.innerHTML = shuffled
      ? '<button class="fav-mode on" id="fav-shuf-toggle" title="exit shuffle">🔀 shuffled <span aria-hidden="true">✕</span></button>'
      : '<button class="fav-mode" id="fav-shuf-toggle">🔀 shuffle</button>';
    inner.querySelector("#fav-shuf-toggle").onclick = () => {
      if (shuffled) renderFavorites("order");
      else { renderFavorites("shuffle"); if (queue.length) play(0); }
    };
  }
  const meta = inner.querySelector("#fav-meta");
  if (meta) meta.textContent = shuffled
    ? ("🔀 SHUFFLED · " + list.length + " TRACKS · ✕ TO EXIT")
    : (favs.length + " SAVED · TAP ♥ TO REMOVE");
  renderTracks(list);
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
  if (shuf.country === "__favs") parts.push("♥ faves");
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
  if (cs){ rs.value = ""; cs.value = country || ""; es.value = ""; gs.value = ""; applyShufFacets(); }
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

/* draw a country's outline (from the already-loaded world-atlas) into an SVG, with city markers */
function drawCountryOutline(code, svgEl){
  if (!svgEl) return;
  const iso = COUNTRIES[code] && +COUNTRIES[code].iso;
  const feat = features.find(f => +f.id === iso);
  if (!feat){ svgEl.innerHTML = `<text x="180" y="104" text-anchor="middle" fill="#8a83b8" font-family="Space Mono,monospace" font-size="11">map loading…</text>`; return; }
  const vb = svgEl.viewBox.baseVal, W = vb.width || 360, H = vb.height || 200, pad = 22;
  const proj = d3.geoMercator().fitExtent([[pad, pad], [W - pad, H - pad]], feat);
  const gp = d3.geoPath(proj);
  const color = COUNTRIES[code].color;
  const cities = (COUNTRY_INFO[code] && COUNTRY_INFO[code].cities) || [];
  // 5-pointed star marker for the capital (outer radius R), so it reads as more important than a city dot
  const starPts = (cx, cy, R) => Array.from({length:10}, (_, i) => {
    const rad = i % 2 ? R * 0.42 : R, a = -Math.PI/2 + i * Math.PI/5;
    return `${(cx + rad*Math.cos(a)).toFixed(2)},${(cy + rad*Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  const dots = cities.map(ci => {
    const p = proj([ci.lng, ci.lat]); if (!p) return "";
    const off = ci.capital ? 10 : 7;   // capital's star is larger → nudge its label out a touch more
    const marker = ci.capital
      ? `<polygon points="${starPts(p[0], p[1], 8)}" fill="${color}" stroke="#0a0916" stroke-width="1.4" stroke-linejoin="round"/>`
      : `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#0a0916" stroke="${color}" stroke-width="2"/>`;
    return `${marker}
      <text x="${p[0] + (p[0] > W*0.72 ? -off : off)}" y="${p[1] + 3}" text-anchor="${p[0] > W*0.72 ? "end" : "start"}"
        fill="#fff7e6" font-family="Space Mono,monospace" font-size="9" font-weight="700"
        style="paint-order:stroke;stroke:#0a0916;stroke-width:2.4px">${esc(ci.name)}</text>`;
  }).join("");
  svgEl.innerHTML =
    `<path d="${gp(feat)}" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` + dots;
}
