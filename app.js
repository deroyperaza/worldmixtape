/* ===================== WORLD MIXTAPE — app logic ===================== */
const ATLAS = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// iso-numeric -> our code
const isoToCode = {};
Object.entries(COUNTRIES).forEach(([code, c]) => { isoToCode[+c.iso] = code; });

// teams that played the 2026 FIFA World Cup (⚽ sticker on their country label)
const WC2026 = new Set(["AR","AU","BR","CA","CO","EG","ES","FR","GB","GH","JP","KR","MX","PA","SN","TR","US","ZA","DE","CD","CV","PT","TN","CI","NO","SE","EC","BE","BA","AT","HR","CH","DZ","MA","PY"]);

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
const isFav = id => favs.some(f => f.trackId === id);
function saveFavs(){ try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {} updateFavCount(); }
function toggleFav(t, cc){
  if (isFav(t.trackId)) favs = favs.filter(f => f.trackId !== t.trackId);
  else favs.unshift({ trackId:t.trackId, artist:t.artist, title:t.title, cover:t.cover, year:t.year,
    genre:t.genre, album:t.album, artistId:t.artistId, decade:t.decade, diaspora:t.diaspora, _cc: t._cc || cc || null });
  saveFavs();
}
function updateFavCount(){
  const el = document.getElementById("fav-count");
  if (el){ el.textContent = favs.length; el.closest(".faves-btn").classList.toggle("has", favs.length > 0); }
}
function refreshFavHearts(){
  document.querySelectorAll(".track__fav").forEach(el => el.classList.toggle("on", isFav(+el.dataset.id)));
  const pf = document.getElementById("p-fav");
  if (pf) pf.classList.toggle("on", qIndex >= 0 && queue[qIndex] && isFav(queue[qIndex].trackId));
  const fm = document.getElementById("fav-meta"); if (fm && !/SHUFFLED/.test(fm.textContent)) fm.textContent = favs.length + " SAVED · TAP ♥ TO REMOVE";
  updateFavCount();
}
function openFavorites(){
  activeCode = null; currentEra = null; currentGenre = null;
  if (!favs.length){
    inner.innerHTML = `<div class="jhead"><div class="jhead__top"><div class="jhead__flag jhead__flag--ico">♡</div>
      <h2 class="jhead__name" style="--accent:var(--pink)">Favorites</h2></div></div>
      <div class="empty">no favorites yet… <em>tap the ♥</em><small>save tracks while you listen and they'll live here.</small></div>`;
    setShuf(""); openPanel(); return;
  }
  inner.innerHTML = `<div class="jhead"><div class="jhead__top"><div class="jhead__flag jhead__flag--ico">♥</div>
    <h2 class="jhead__name" style="--accent:var(--pink)">Favorites</h2></div>
    <div class="jhead__meta" id="fav-meta"></div></div>
    <div class="fav-ctrls" id="fav-ctrls"></div>
    <div id="tracklist"></div>`;
  setShuf("__favs");   // shuffle pre-filtered to favorites
  renderFavorites("order");
  openPanel();
}

function renderFavorites(mode){
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

function openPanel(){ panel.classList.add("show"); scrim.classList.add("show"); panel.setAttribute("aria-hidden","false"); }
function closePanel(){ panel.classList.remove("show"); scrim.classList.remove("show"); panel.setAttribute("aria-hidden","true"); d3.selectAll("path.country").classed("active", false); }
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

  inner.innerHTML = `
    <div class="jhead">
      <div class="jhead__top">
        <div class="jhead__flag">${flagImg(code)}</div>
        <h2 class="jhead__name" style="--accent:${c.color}">${c.name}${WC2026.has(code) ? '<span class="wc-ball" title="2026 World Cup team" aria-label="2026 World Cup team">⚽</span>' : ''}</h2>
      </div>
      <div class="jhead__meta" id="jmeta">NATIVES + DIÁSPORA · ${c.name.toUpperCase()}</div>
    </div>
    ${eraBar}
    ${genreBar}
    <div id="tracklist"></div>`;

  inner.querySelectorAll(".era").forEach(b => b.onclick = () => renderEra(b.dataset.era));
  inner.querySelectorAll(".genre").forEach(b => b.onclick = () => renderGenre(b.dataset.genre));
  renderEra("now");
  setShuf(code);   // shuffle is now pre-filtered to this country
}

function renderTracks(list){
  const tl = inner.querySelector("#tracklist");
  renderedList = list;
  const accOf = t => (t._cc && COUNTRIES[t._cc] ? COUNTRIES[t._cc].color
    : (activeCode && COUNTRIES[activeCode] ? COUNTRIES[activeCode].color : "#ff2e92"));
  tl.innerHTML = list.map((t, i) => `
    <div class="track" data-i="${i}" style="animation-delay:${Math.min(i,30)*0.03}s;--accent:${accOf(t)}">
      <div class="track__rank">${i+1}${t.year?`<span class="track__yr">${t.year}</span>`:''}</div>
      <img class="track__art" loading="lazy" src="${t.cover||''}" alt="">
      <div class="track__txt">
        <div class="track__title">${esc(t.title)}</div>
        <div class="track__artist">${esc(t.artist)}${t.diaspora?'<span class="track__nf">diáspora</span>':''}</div>
      </div>
      <button class="track__fav${isFav(t.trackId)?" on":""}" data-i="${i}" data-id="${t.trackId}" aria-label="Save to favorites">♥</button>
      <button class="track__play" aria-label="Play">▶</button>
    </div>`).join("");
  tl.querySelectorAll(".track").forEach(el => el.onclick = () => play(+el.dataset.i));
  tl.querySelectorAll(".track__fav").forEach(el => el.onclick = e => {
    e.stopPropagation(); toggleFav(list[+el.dataset.i], activeCode); refreshFavHearts();
  });
  tl.querySelectorAll(".track").forEach(el => {   // hover → ticker any cut-off title/artist
    el.addEventListener("mouseenter", () => { hoverMq(el.querySelector(".track__title"), true); hoverMq(el.querySelector(".track__artist"), true); });
    el.addEventListener("mouseleave", () => { hoverMq(el.querySelector(".track__title"), false); hoverMq(el.querySelector(".track__artist"), false); });
  });
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
  if (meta) meta.textContent = (key === "now" ? "RIGHT NOW" : key === "pre1940s" ? "PRE-1940s" : key.toUpperCase()) + " · NATIVES + DIÁSPORA";

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
  if (meta) meta.textContent = g.toUpperCase() + " · " + list.length + " TRACKS · ALL ERAS";
  renderTracks(list);
}

const esc = s => (s||"").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/* ---------- shuffle the world (with country / era / genre filters) ---------- */
const cap = g => g.replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
let shuf = { country: "", era: "", genre: "" };

(function initShufflePop(){
  const pop = document.getElementById("shuffle-pop");
  if (!pop) return;
  const countries = Object.entries(COUNTRIES).map(([code, c]) => [code, c.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const gset = new Set();
  Object.values(COUNTRIES).forEach(c => Object.values(c.eras).forEach(l => l.forEach(t => t.genre && gset.add(t.genre))));
  const genres = [...gset].sort();
  pop.innerHTML = `
    <h4>shuffle…</h4>
    <div><label>where</label><select id="f-country"><option value="">🌍 everywhere</option><option value="__favs">♥ my favorites</option>${countries.map(([code, n]) => `<option value="${code}">${esc(n)}</option>`).join("")}</select></div>
    <div><label>when</label><select id="f-era"><option value="">all eras</option>${ERAS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
    <div><label>what</label><select id="f-genre"><option value="">all genres</option>${genres.map(g => `<option value="${esc(g)}">${esc(cap(g))}</option>`).join("")}</select></div>
    <button class="shuffle-go" id="f-go">▶ shuffle these</button>
    <button class="shuffle-reset" id="f-reset">reset filters</button>
    <div class="shuffle-empty" id="f-empty" hidden>no tracks for that combo</div>`;

  const cs = document.getElementById("f-country"), es = document.getElementById("f-era"), gs = document.getElementById("f-genre");
  const sync = () => { shuf = { country: cs.value, era: es.value, genre: gs.value }; document.getElementById("f-empty").hidden = true; updateScope(); };
  cs.onchange = es.onchange = gs.onchange = sync;
  document.getElementById("f-go").onclick = () => doShuffle();
  document.getElementById("f-reset").onclick = () => { cs.value = es.value = gs.value = ""; sync(); };
})();

function updateScope(){
  const parts = [];
  if (shuf.country === "__favs") parts.push("♥ faves");
  else if (shuf.country) parts.push(COUNTRIES[shuf.country].name);
  if (shuf.era) parts.push((ERAS.find(e => e[0] === shuf.era) || [])[1]);
  if (shuf.genre) parts.push(cap(shuf.genre));
  document.getElementById("shuffle-scope").textContent = parts.length ? parts.join(" · ") : "the world";
  document.getElementById("shuffle-filt").classList.toggle("on", parts.length > 0);
}

// pre-filter the shuffle scope to what's on screen (country / favorites / world)
function setShuf(country){
  shuf.country = country || "";
  const cs = document.getElementById("f-country"); if (cs) cs.value = shuf.country;
  updateScope();
}

function doShuffle(){
  const all = [];
  if (shuf.country === "__favs"){
    favs.forEach(t => {
      if (shuf.era && t.decade !== shuf.era) return;
      if (shuf.genre && t.genre !== shuf.genre) return;
      all.push(Object.assign({}, t));
    });
  } else {
    Object.entries(COUNTRIES).forEach(([code, c]) => {
      if (shuf.country && code !== shuf.country) return;
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
    // global (or no panel open) → lean back to the map
    closePanel();
    activeCode = null; currentEra = null; currentGenre = null;
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

async function play(i){
  if (!queue.length) return;
  qIndex = (i + queue.length) % queue.length;
  const t = queue[qIndex];
  const cc = t._cc || activeCode;
  player.classList.add("show"); player.setAttribute("aria-hidden","false");
  document.getElementById("p-art").src = t.cover || "";
  setMeta(document.getElementById("p-title"), esc(t.title));
  setMeta(document.getElementById("p-artist"), esc(t.artist)
    + (cc ? " · " + flagImg(cc) + " " + esc(COUNTRIES[cc].name) : "")
    + (t.year ? " · " + t.year : "") + (t.genre ? " · " + esc(t.genre.replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())) : ""));
  document.getElementById("p-progress").style.width = "0%";
  setPlayIcon(true); player.classList.add("playing");
  // world-shuffle: light up the track's country on the map as it plays
  if (t._cc){
    d3.selectAll("path.country").classed("active", false);
    gMap.selectAll("path.country").filter(x => isoToCode[+x.id] === t._cc).classed("active", true);
  }
  highlightRow();
  refreshFavHearts();

  // full-song mode: desktop streams in-browser (SDK); mobile remote-controls the Spotify app (Connect)
  if (fullMode && SPOT.fullReady()){
    audio.pause();
    let uri = t._spUri;
    if (uri === undefined){ uri = await SPOT.search(t.artist, t.title); t._spUri = uri || null; }
    if (queue[qIndex] !== t) return;                 // user skipped while we were resolving
    if (uri){
      const r = await SPOT.playFull(uri);
      if (r === "ok"){ playSource = "full"; lastPos = 0; startFullPoll(); return; }
      if (r === "needs-auth"){ SPOT.login(); return; }
      if (r === "no-device"){ flashPlayerNote("Open Spotify on your phone, hit play once, then tap ▶ here"); playSource = "full"; stopFullPoll(); setPlayIcon(false); player.classList.remove("playing"); return; }
    }
    if (SPOT.isMobile){                              // Connect-only: never silently fall back to a preview on mobile
      flashPlayerNote(uri ? "Spotify couldn't play that — open the app & retry" : "not on Spotify — skipping");
      playSource = "full"; stopFullPoll(); setPlayIcon(false); player.classList.remove("playing");
      if (!uri) setTimeout(() => { if (queue[qIndex] === t) next(); }, 1300);
      return;
    }
    // desktop only: no Spotify match → fall through to the 30s preview for this one
  }
  stopFullPoll();
  if (SPOT.isConnected()) SPOT.pause();
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

function setPlayIcon(playing){ document.getElementById("p-play").textContent = playing ? "❚❚" : "▶"; }

function togglePlay(){
  if (qIndex < 0){ if (queue.length) play(0); return; }
  if (playSource === "full"){ SPOT.toggle(); return; }
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

/* ---------- full-song mode (Spotify Web Playback SDK) ---------- */
let fullMode = localStorage.getItem("wmx_fullmode") === "1";
let playSource = "preview";
let lastPos = 0;

function updateFullUI(){
  const b = document.getElementById("p-full");
  if (b){
    b.classList.toggle("on", fullMode);
    b.title = fullMode ? "Full songs via Spotify — tap for 30s previews" : "Switch to full songs (needs Spotify Premium)";
  }
  updateSpCta();
}

/* homepage "connect Spotify" CTA bar — shows until connected, then hides */
const spCta = document.getElementById("sp-cta");
function updateSpCta(){
  if (!spCta) return;
  const lbl = document.getElementById("sp-cta-lbl");
  if (!SPOT.hasClientId() || sessionStorage.getItem("wmx_cta_x") === "1"){ spCta.hidden = true; return; }
  spCta.hidden = false;
  const connected = SPOT.isConnected();
  spCta.classList.toggle("on", connected);                       // green once connected
  if (lbl) lbl.textContent = !connected ? "Connect Spotify — full songs"
    : (fullMode ? "Connected — full songs on" : "Connected — tap for full songs");
}
{
  const go = document.getElementById("sp-cta-go"), x = document.getElementById("sp-cta-x");
  if (go) go.onclick = () => toggleFull();                       // kicks off the Spotify connect flow
  if (x)  x.onclick = e => { e.stopPropagation(); sessionStorage.setItem("wmx_cta_x", "1"); updateSpCta(); };
}
function flashPlayerNote(msg){
  const el = document.getElementById("p-artist"); if (!el) return;
  const prev = el.innerHTML; el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.innerHTML = prev; }, 2400);
}
async function toggleFull(){
  if (!fullMode){
    if (!SPOT.hasClientId()){ flashPlayerNote("connect Spotify: add your Client ID in spotify.js"); return; }
    if (!SPOT.isConnected() || SPOT.needsReauth()){ SPOT.login(); return; }   // mobile Connect needs extra scopes → re-auth
    fullMode = true; localStorage.setItem("wmx_fullmode", "1"); SPOT.initSDK();
    flashPlayerNote(SPOT.isMobile ? "full songs on · plays through your Spotify app" : "full songs on · connecting Spotify…");
  } else {
    fullMode = false; localStorage.removeItem("wmx_fullmode"); SPOT.pause(); stopFullPoll(); playSource = "preview";
  }
  updateFullUI();
  if (qIndex >= 0) play(qIndex);
}

SPOT.onState(s => {                                          // desktop SDK: drive the bar + auto-advance
  if (!fullMode || !s) return;
  const dur = s.duration || 0, pos = s.position || 0;
  curDuration = dur;
  if (!scrubbing && dur) document.getElementById("p-progress").style.width = (pos / dur * 100) + "%";
  setPlayIcon(!s.paused); player.classList.toggle("playing", !s.paused);
  if (s.paused && pos === 0 && lastPos > 2000){ lastPos = 0; next(); return; }   // track finished
  lastPos = pos;
});

/* mobile Connect: no SDK state events, so poll the Spotify app's playback to drive the bar + auto-advance */
let fullPoll = null;
function stopFullPoll(){ if (fullPoll){ clearInterval(fullPoll); fullPoll = null; } }
function startFullPoll(){
  if (!SPOT.isMobile) return;                                // desktop is driven by the SDK's onState
  stopFullPoll();
  fullPoll = setInterval(async () => {
    if (playSource !== "full"){ stopFullPoll(); return; }
    const s = await SPOT.getPlayback(); if (!s) return;
    curDuration = s.duration || 0;
    if (!scrubbing && s.duration) document.getElementById("p-progress").style.width = (s.position / s.duration * 100) + "%";
    setPlayIcon(!s.paused); player.classList.toggle("playing", !s.paused);
    if (s.duration){
      const ended = (!s.paused && s.position >= s.duration - 1200) || (s.paused && lastPos > 3000 && s.position <= 2000);
      if (ended){ lastPos = 0; next(); return; }
    }
    if (!s.paused) lastPos = s.position;
  }, 1000);
}

const pFull = document.getElementById("p-full");
if (pFull) pFull.onclick = toggleFull;

(async () => {                                               // complete OAuth handoff / restore session
  const cameBack = await SPOT.handleRedirect();
  if (cameBack){ fullMode = true; localStorage.setItem("wmx_fullmode", "1"); }
  if (SPOT.isConnected()) SPOT.initSDK(); else fullMode = false;
  updateFullUI();
})();

audio.addEventListener("timeupdate", () => {
  if (!scrubbing && audio.duration) document.getElementById("p-progress").style.width = (audio.currentTime/audio.duration*100) + "%";
});
audio.addEventListener("ended", next);
audio.addEventListener("pause", () => { setPlayIcon(false); player.classList.remove("playing"); });
audio.addEventListener("play",  () => { setPlayIcon(true);  player.classList.add("playing"); });

/* ---------- seek: click or drag the progress bar (works for preview + Spotify) ---------- */
let curDuration = 0, scrubbing = false;
const seekBar = document.querySelector(".player__bar");
function barFrac(e){
  const r = seekBar.getBoundingClientRect();
  const x = (e.clientX != null ? e.clientX : 0) - r.left;
  return Math.max(0, Math.min(1, r.width ? x / r.width : 0));
}
const setFill = f => { document.getElementById("p-progress").style.width = (f * 100) + "%"; };
function seekTo(f){
  if (playSource === "full"){ if (curDuration) SPOT.seek(Math.round(f * curDuration)); }
  else if (audio.duration){ audio.currentTime = f * audio.duration; }
  setFill(f);
}
if (seekBar){
  seekBar.addEventListener("pointerdown", e => {
    if (qIndex < 0) return;
    scrubbing = true; seekBar.classList.add("scrub");
    try { seekBar.setPointerCapture(e.pointerId); } catch {}
    setFill(barFrac(e)); e.preventDefault();
  });
  seekBar.addEventListener("pointermove", e => { if (scrubbing) setFill(barFrac(e)); });
  seekBar.addEventListener("pointerup", e => { if (!scrubbing) return; scrubbing = false; seekBar.classList.remove("scrub"); seekTo(barFrac(e)); });
  seekBar.addEventListener("pointercancel", () => { scrubbing = false; seekBar.classList.remove("scrub"); });
}

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
    '<div class="clist__head"><div class="brand__tape"><img class="brand__logo" src="logo.png" alt="World Mixtape"><div class="brand__title">WORLD<br><span>MIXTAPE</span></div></div><p class="brand__sub">The world&#39;s local music,<br>decade by decade.</p></div>' +
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


/* ---------- album art lightbox ---------- */
const artModal = document.getElementById("art-modal");
function openArt(){
  const t = queue[qIndex]; if (!t || !t.cover) return;
  document.getElementById("art-modal-img").src = t.cover;
  artModal.hidden = false;
}
function closeArt(){ artModal.hidden = true; document.getElementById("art-modal-img").src = ""; }
document.getElementById("p-art").addEventListener("click", openArt);
document.getElementById("art-x").addEventListener("click", closeArt);
artModal.addEventListener("click", e => { if (e.target === artModal) closeArt(); });
