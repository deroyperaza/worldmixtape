/* ===================== Spotify full-track playback =====================
   Web Playback SDK + OAuth (Authorization Code with PKCE — client-side, no
   backend, no client secret). Plays FULL songs for listeners who connect a
   Spotify PREMIUM account. Everything degrades to the 30s preview otherwise.

   SETUP (one time):
   1. developer.spotify.com/dashboard → Create App (free).
   2. In the app's settings add a Redirect URI = the exact URL you load this
      page from (e.g. http://127.0.0.1:8080  and your deployed https URL).
   3. Paste the app's Client ID below.
*/
const SPOT = (() => {
  const CLIENT_ID = "";                                  // ← paste your Spotify Client ID here
  const SCOPES = "streaming user-read-email user-read-private";
  const TOKEN_KEY = "wmx_spotify_tok";
  const redirectUri = () => location.origin + location.pathname;

  let token = null, tokenExp = 0, refreshTok = null;
  let player = null, deviceId = null, ready = false, premiumOK = true;
  let stateCb = null;

  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY)); if (t){ token = t.access; tokenExp = t.exp; refreshTok = t.refresh; } } catch {}

  /* ---- PKCE helpers ---- */
  const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => ("0" + x.toString(16)).slice(-2)).join(""); };
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const challenge = async v => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));

  function setTok(j){
    token = j.access_token;
    tokenExp = Date.now() + (j.expires_in * 1000) - 60000;
    if (j.refresh_token) refreshTok = j.refresh_token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access: token, exp: tokenExp, refresh: refreshTok }));
  }
  async function tokenReq(params){
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params)
    });
    const j = await r.json().catch(() => ({}));
    if (j.access_token){ setTok(j); return true; }
    return false;
  }
  async function refresh(){ return refreshTok ? tokenReq({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshTok }) : false; }
  async function validToken(){ if (token && Date.now() < tokenExp) return token; if (await refresh()) return token; token = null; return null; }

  async function login(){
    if (!CLIENT_ID) return false;
    const v = rand(48);
    sessionStorage.setItem("wmx_pkce", v);
    const p = new URLSearchParams({
      client_id: CLIENT_ID, response_type: "code", redirect_uri: redirectUri(),
      code_challenge_method: "S256", code_challenge: await challenge(v), scope: SCOPES
    });
    location.href = "https://accounts.spotify.com/authorize?" + p;
    return true;
  }

  // run on page load — completes the OAuth handoff if we came back with ?code
  async function handleRedirect(){
    const u = new URL(location.href);
    const code = u.searchParams.get("code");
    if (!code) return false;
    const v = sessionStorage.getItem("wmx_pkce");
    const ok = v && await tokenReq({ client_id: CLIENT_ID, grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: v });
    u.searchParams.delete("code"); u.searchParams.delete("state");
    history.replaceState({}, "", u.pathname + u.search + u.hash);
    return ok;
  }

  function initSDK(){
    if (player || !token) return;
    if (!window.Spotify){
      if (!document.getElementById("spot-sdk")){
        const s = document.createElement("script"); s.id = "spot-sdk"; s.src = "https://sdk.scdn.co/spotify-player.js"; document.body.appendChild(s);
      }
      window.onSpotifyWebPlaybackSDKReady = initSDK; return;
    }
    player = new Spotify.Player({ name: "World Mixtape", volume: 0.85, getOAuthToken: async cb => cb(await validToken()) });
    player.addListener("ready", ({ device_id }) => { deviceId = device_id; ready = true; premiumOK = true; });
    player.addListener("not_ready", () => { ready = false; });
    player.addListener("player_state_changed", s => { if (stateCb) stateCb(s); });
    player.addListener("account_error", () => { ready = false; premiumOK = false; });   // not Premium
    player.addListener("authentication_error", () => { ready = false; token = null; });
    player.connect();
  }

  async function search(artist, title){
    const t = await validToken(); if (!t) return null;
    const r = await fetch("https://api.spotify.com/v1/search?" + new URLSearchParams({ q: `track:"${title}" artist:"${artist}"`, type: "track", limit: "5" }),
      { headers: { Authorization: "Bearer " + t } });
    const j = await r.json().catch(() => ({}));
    const items = (j.tracks && j.tracks.items) || [];
    const norm = s => (s || "").toLowerCase();
    const hit = items.find(it =>
      norm(it.name).includes(norm(title).slice(0, 6)) &&
      it.artists.some(a => norm(a.name).includes(norm(artist).slice(0, 4)))
    ) || items[0];
    return hit ? hit.uri : null;
  }

  async function playUri(uri){
    const t = await validToken(); if (!t || !deviceId) return false;
    const r = await fetch("https://api.spotify.com/v1/me/player/play?" + new URLSearchParams({ device_id: deviceId }),
      { method: "PUT", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ uris: [uri] }) });
    return r.ok;
  }

  return {
    hasClientId: () => !!CLIENT_ID,
    isConnected: () => !!token,
    ready: () => ready,
    premiumOK: () => premiumOK,
    login, handleRedirect, initSDK, search, playUri,
    toggle: () => player && player.togglePlay(),
    pause: () => player && player.pause(),
    onState: cb => { stateCb = cb; },
  };
})();
