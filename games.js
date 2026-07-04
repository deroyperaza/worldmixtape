/* World Mixtape — Games engine + 3 games. Reuses COUNTRIES, COUNTRY_MUSIC, world-atlas. No backend. */
(function(){
"use strict";

/* ---------------- continents (authored — not in the catalog) ---------------- */
var CONT_LIST = {
 AF:"AF DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RE RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH XG",
 EU:"EU AD AL AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA",
 AS:"AS AF AM AZ BH BD BT BN KH CN GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE",
 NA:"NA AG BS BB BZ CA CR CU CW DM DO SV GD GL GT HT HN JM MX NI PA PR KN LC VC TT US",
 SA:"SA AR BO BR CL CO EC GY PY PE SR UY VE",
 OC:"OC AU FJ FM KI NC NZ PG SB TO TV VU WS"
};
var CONT_NAME={AF:"Africa",EU:"Europe",AS:"Asia",NA:"North America",SA:"South America",OC:"Oceania"};
var CONT={};
Object.keys(CONT_LIST).forEach(function(k){ CONT_LIST[k].split(" ").forEach(function(c){ if(c.length===2) CONT[c]=k; }); });

/* ---------------- seeded RNG (deterministic daily, no backend) ---------------- */
function xmur3(str){var h=1779033703^str.length;for(var i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return (h^=h>>>16)>>>0;};}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function dayStr(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function dayNumber(){ // #1 = launch day, stable-ish index for share
  return Math.floor(Date.parse(dayStr()+"T00:00:00Z")/864e5) - 20270; }
function rngFor(key){var seed=xmur3(dayStr()+"::"+key)();return mulberry32(seed);}
function pick(arr,rng){return arr[Math.floor(rng()*arr.length)];}
function shuffle(arr,rng){arr=arr.slice();for(var i=arr.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}

/* ---------------- helpers ---------------- */
function flagSrc(c){return "https://flagcdn.com/"+c.toLowerCase()+".svg";}
function flagImg(c,cls){return '<img class="flag'+(cls?" "+cls:"")+'" src="'+flagSrc(c)+'" alt="'+c+'" loading="lazy">';}
function cname(c){return (window.COUNTRIES[c]&&window.COUNTRIES[c].name)||c;}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m];});}
var DECADE_ORDER=["1900s","1910s","1920s","1930s","1940s","1950s","1960s","1970s","1980s","1990s","2000s","2010s","2020s","now"];
function decLabel(d){return d==="now"?"Now":d;}
function yearFits(y,dec){if(!y)return false;if(dec==="now")return true;var s=parseInt(dec,10);return s?(y>=s&&y<s+10):false;}

/* tracks that are playable */
function tracksOf(c){var o=window.COUNTRIES[c],out=[];if(!o||!o.eras)return out;Object.keys(o.eras).forEach(function(dec){(o.eras[dec]||[]).forEach(function(t){if(t&&t.ytId){var x=Object.assign({},t);x._cc=c;x.decade=x.decade||dec;out.push(x);}});});return out;}
function artistsOf(c){var seen={},out=[];tracksOf(c).forEach(function(t){var a=(t.artist||"").trim();if(a&&!seen[a.toLowerCase()]){seen[a.toLowerCase()]=1;out.push(a);}});return out;}

/* ---------------- persistent state ---------------- */
var SKEY="wmt_games_v2";
function load(){try{return JSON.parse(localStorage.getItem(SKEY))||{};}catch(e){return {};}}
function save(s){try{localStorage.setItem(SKEY,JSON.stringify(s));}catch(e){}}
var STATE=load();
if(!STATE.passport)STATE.passport={};
if(!STATE.plays)STATE.plays={};
function stamp(c){if(!c)return;STATE.passport[c]=(STATE.passport[c]||0)+1;save(STATE);}
function bumpStreak(){var d=dayStr();if(STATE.lastWinDay===d)return;var y=new Date(Date.now()-864e5);var yStr=y.getFullYear()+"-"+String(y.getMonth()+1).padStart(2,"0")+"-"+String(y.getDate()).padStart(2,"0");STATE.streak=(STATE.lastWinDay===yStr)?(STATE.streak||0)+1:1;STATE.lastWinDay=d;save(STATE);}
function playedToday(game){var p=STATE.plays[game];return p&&p.day===dayStr()?p:null;}
function recordPlay(game,summary){STATE.plays[game]={day:dayStr(),summary:summary};save(STATE);}

/* ---------------- centroids (from world-atlas, for Sound Trip) ---------------- */
var CENTROID={},ATLAS_READY=false,atlasWaiters=[];
function loadAtlas(){
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then(function(world){
    var feats=topojson.feature(world,world.objects.countries).features;
    var byId={};feats.forEach(function(f){byId[String(f.id)]=f;});
    Object.keys(window.COUNTRIES).forEach(function(c){
      var f=byId[String(window.COUNTRIES[c].iso).padStart(3,"0")];
      if(f){try{var ce=d3.geoCentroid(f);if(ce&&isFinite(ce[0])&&isFinite(ce[1]))CENTROID[c]=ce;}catch(e){}}
    });
    ATLAS_READY=true;atlasWaiters.forEach(function(fn){fn();});atlasWaiters=[];
  }).catch(function(){ATLAS_READY=true;atlasWaiters.forEach(function(fn){fn();});atlasWaiters=[];});
}
function whenAtlas(fn){ATLAS_READY?fn():atlasWaiters.push(fn);}
function distKm(a,b){var A=CENTROID[a],B=CENTROID[b];if(!A||!B)return null;return Math.round(d3.geoDistance(A,B)*6371);}
var ARROWS=["⬆️","↗️","➡️","↘️","⬇️","↙️","⬅️","↖️"];
function bearingArrow(from,to){var A=CENTROID[from],B=CENTROID[to];if(!A||!B)return "";var φ1=A[1]*Math.PI/180,φ2=B[1]*Math.PI/180,Δλ=(B[0]-A[0])*Math.PI/180;var y=Math.sin(Δλ)*Math.cos(φ2),x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);var brng=(Math.atan2(y,x)*180/Math.PI+360)%360;return ARROWS[Math.round(brng/45)%8];}

/* ---------------- hidden YouTube audio player ---------------- */
var YT_PLAYER=null,YT_READY=false,ytQueue=null;
window.onYouTubeIframeAPIReady=function(){
  YT_PLAYER=new YT.Player("yt-audio",{height:"200",width:"200",playerVars:{playsinline:1,controls:0,disablekb:1},events:{onReady:function(){YT_READY=true;if(ytQueue){var q=ytQueue;ytQueue=null;playVid(q.id,q.start);}}}});
};
function playVid(id,start){if(!YT_READY||!YT_PLAYER){ytQueue={id:id,start:start};return;}try{YT_PLAYER.loadVideoById({videoId:id,startSeconds:start||0});YT_PLAYER.playVideo();}catch(e){}}
function pauseVid(){try{YT_PLAYER&&YT_PLAYER.pauseVideo();}catch(e){}}
function playedState(){try{return YT_PLAYER&&YT_PLAYER.getPlayerState&&YT_PLAYER.getPlayerState()===1;}catch(e){return false;}}

/* ---------------- toast + share ---------------- */
function toast(msg){var t=document.getElementById("g-toast");t.textContent=msg;t.classList.add("on");setTimeout(function(){t.classList.remove("on");},1600);}
function copyShare(text){var done=function(){toast("Copied — go paste it!");};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,function(){fallbackCopy(text);done();});}else{fallbackCopy(text);done();}}
function fallbackCopy(text){var ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");}catch(e){}document.body.removeChild(ta);}

/* ---------------- router ---------------- */
function show(id){["hub","soundtrip","timemachine","clusters"].forEach(function(v){document.getElementById("view-"+v).classList.toggle("on",v===id);});pauseVid();window.scrollTo(0,0);if(id==="hub")renderHub();}
window.WMTG={show:show};

/* ---------------- HUB ---------------- */
function renderHub(){
  var pc=Object.keys(STATE.passport).length;
  document.getElementById("stat-streak").textContent=STATE.streak||0;
  document.getElementById("stat-passport").textContent=pc;
  document.getElementById("stat-total").textContent="197";
  var cards=[
    {id:"soundtrip",em:"🎧",ac:"var(--pink)",h:"Sound Trip",p:"Hear a song. Guess the country it comes from. Every clue pulls you closer.",game:"soundtrip"},
    {id:"timemachine",em:"🕰️",ac:"var(--cyan)",h:"Time Machine",p:"Same music, different question: what decade is this from? Earlier or later?",game:"timemachine"},
    {id:"clusters",em:"🧩",ac:"var(--lime)",h:"Culture Clusters",p:"16 artists, 4 countries. Sort them into their homelands — but watch your guesses.",game:"clusters"}
  ];
  document.getElementById("g-cards").innerHTML=cards.map(function(c){
    var pt=playedToday(c.game);
    return '<button class="g-card" style="--accent:'+c.ac+'" onclick="WMTG.open(\''+c.game+'\')">'+
      '<h3>'+c.h+'</h3><p>'+c.p+'</p>'+
      '<div class="g-cardfoot"><span>'+(pt?"✓ played today":"Daily · tap to play")+'</span><span class="g-emoji">'+c.em+'</span></div></button>';
  }).join("");
}
window.WMTG.open=function(game){show(game);if(game==="soundtrip")startSoundTrip();else if(game==="timemachine")startTimeMachine();else startClusters();};

/* ==================================================================
   GAME 1 — SOUND TRIP
   ================================================================== */
function soundTripPool(){return Object.keys(window.COUNTRIES).filter(function(c){return CENTROID[c]&&tracksOf(c).length>0;}).sort();}
var ST={};
function startSoundTrip(){
  var box=document.getElementById("st-body");
  box.innerHTML='<div class="g-done">Loading the map…</div>';
  whenAtlas(function(){
    var rng=rngFor("soundtrip");
    var pool=soundTripPool();
    var ans=pick(pool,rng);
    var tks=tracksOf(ans);
    var track=pick(tks,rng);
    var start=15+Math.floor(rng()*35);
    ST={ans:ans,track:track,start:start,rng:rng,pool:pool,guesses:[],done:false,mode:STATE.stMode||"kid"};
    var pt=playedToday("soundtrip");
    if(pt){ST.done=true;renderSTReveal(pt.summary);return;}
    renderST();
  });
}
function stChoices(){ // kid mode: answer + 3 distractors, prefer same continent
  var ans=ST.ans,cont=CONT[ans];
  var same=ST.pool.filter(function(c){return c!==ans&&CONT[c]===cont;});
  var other=ST.pool.filter(function(c){return c!==ans&&CONT[c]!==cont;});
  var d=shuffle(same,ST.rng).slice(0,2).concat(shuffle(other,ST.rng).slice(0,2)).slice(0,3);
  return shuffle([ans].concat(d),ST.rng);
}
function renderST(){
  var body=document.getElementById("st-body");
  var guessesHtml=ST.guesses.map(function(g){
    var km=distKm(g,ST.ans),same=CONT[g]===CONT[ST.ans],win=g===ST.ans;
    var fb=win?'<span class="same">✓ nailed it!</span>':(km==null?(same?'<span class="same">right continent</span>':'<span class="km">wrong region</span>'):'<span class="km">'+km.toLocaleString()+' km</span> '+bearingArrow(g,ST.ans)+(same?' <span class="same">·same continent</span>':''));
    return '<div class="g-guessrow'+(win?' win':(same?' near':''))+'">'+flagImg(g)+'<span class="nm">'+esc(cname(g))+'</span><span class="fb">'+fb+'</span></div>';
  }).join("");
  var input;
  if(ST.mode==="kid"){
    if(!ST.choiceSet)ST.choiceSet=stChoices();
    input='<div class="g-choices">'+ST.choiceSet.map(function(c){var used=ST.guesses.indexOf(c)>=0;return '<button class="g-choice'+(used?(c===ST.ans?" right":" wrong"):"")+'" '+(used?"disabled":"")+' onclick="WMTG.stGuess(\''+c+'\')">'+flagImg(c)+esc(cname(c))+'</button>';}).join("")+'</div>';
  }else{
    input='<div class="g-search"><input id="st-input" type="text" placeholder="Type a country and pick…" autocomplete="off" oninput="WMTG.stSuggest(this.value)"><div class="g-suggest" id="st-suggest" style="display:none"></div></div>';
  }
  var hintN=ST.guesses.length;
  var hint=hintN>=3?'<div class="g-hint">Hint: it\'s in <b>'+CONT_NAME[CONT[ST.ans]]+'</b> '+flagImg(ST.ans,"")+'</div>':'<div class="g-hint">'+(5-hintN)+' guesses left · hint unlocks after 3</div>';
  body.innerHTML=
    '<div class="g-modes"><button class="'+(ST.mode==="kid"?"on":"")+'" onclick="WMTG.stMode(\'kid\')">Kid · 4 choices</button><button class="'+(ST.mode==="explorer"?"on":"")+'" onclick="WMTG.stMode(\'explorer\')">Explorer · search</button></div>'+
    '<div class="g-player" id="st-player"><button class="g-play" id="st-play" onclick="WMTG.stPlay()">▶</button><div class="g-eq">'+eqBars()+'</div><div class="g-hint">Tap to hear today\'s mystery song</div></div>'+
    guessesHtml+input+hint;
}
function eqBars(){var s="";for(var i=0;i<11;i++)s+="<span></span>";return s;}
window.WMTG.stPlay=function(){var pl=document.getElementById("st-player"),btn=document.getElementById("st-play");if(playedState()){pauseVid();pl.classList.remove("playing");btn.textContent="▶";btn.classList.remove("playing");}else{playVid(ST.track.ytId,ST.start);pl.classList.add("playing");btn.textContent="❚❚";btn.classList.add("playing");}};
window.WMTG.stMode=function(m){if(ST.done)return;ST.mode=m;STATE.stMode=m;save(STATE);ST.choiceSet=null;renderST();};
window.WMTG.stSuggest=function(q){var box=document.getElementById("st-suggest");q=(q||"").trim().toLowerCase();if(q.length<1){box.style.display="none";return;}var m=Object.keys(window.COUNTRIES).filter(function(c){return cname(c).toLowerCase().indexOf(q)>=0&&ST.guesses.indexOf(c)<0;}).sort(function(a,b){return cname(a).localeCompare(cname(b));}).slice(0,8);if(!m.length){box.style.display="none";return;}box.innerHTML=m.map(function(c){return '<button onclick="WMTG.stGuess(\''+c+'\')">'+flagImg(c)+esc(cname(c))+'</button>';}).join("");box.style.display="block";};
window.WMTG.stGuess=function(c){if(ST.done||ST.guesses.indexOf(c)>=0)return;ST.guesses.push(c);ST.choiceSet=ST.choiceSet;var sug=document.getElementById("st-suggest");if(sug)sug.style.display="none";
  if(c===ST.ans){finishST(true);}
  else if(ST.guesses.length>=(ST.mode==="kid"?4:5)){finishST(false);}
  else renderST();
};
function stShareGrid(){return ST.guesses.map(function(g){return g===ST.ans?"🟩":(CONT[g]===CONT[ST.ans]?"🟨":"🟥");}).join("");}
function finishST(win){
  ST.done=true;
  var summary={win:win,ans:ST.ans,tries:ST.guesses.length,grid:stShareGrid(),artist:ST.track.artist,title:ST.track.title,decade:ST.track.decade,year:ST.track.year,ytId:ST.track.ytId,start:ST.start};
  if(win){stamp(ST.ans);bumpStreak();}
  recordPlay("soundtrip",summary);
  renderSTReveal(summary);
}
function renderSTReveal(s){
  ST.done=true;ST.track=ST.track||{ytId:s.ytId};ST.start=s.start;
  var lesson=(window.COUNTRY_MUSIC&&window.COUNTRY_MUSIC[s.ans]&&window.COUNTRY_MUSIC[s.ans][0])||"";
  var body=document.getElementById("st-body");
  body.innerHTML=
    '<div class="g-reveal"><div class="badge'+(s.win?"":" miss")+'">'+(s.win?"✓ Solved in "+s.tries+"!":"Today\'s answer")+'</div>'+
    '<div class="g-answer">'+flagImg(s.ans)+'<div><div class="a-nm">'+esc(cname(s.ans))+'</div><div class="a-sub">'+esc(s.title)+' · '+esc(s.artist)+' · '+decLabel(s.decade)+'</div></div></div>'+
    (lesson?'<div class="g-lesson"><span class="k">🎵 The sound of '+esc(cname(s.ans))+'</span>'+esc(lesson)+'</div>':"")+
    '<div class="g-player" id="st-player" style="margin-bottom:12px"><button class="g-play" id="st-play" onclick="WMTG.stPlay()">▶</button><div class="g-eq">'+eqBars()+'</div><div class="g-hint">Hear the full song</div></div>'+
    '<div class="g-sharegrid">'+s.grid+'</div><div class="g-sharecap">Sound Trip #'+dayNumber()+' · '+s.tries+(s.win?"/5 🎯":"/5")+'</div>'+
    '<div class="g-btns"><button class="g-btn p" onclick="WMTG.stShare()">Share</button><a class="g-btn s" href="/" >Explore '+esc(cname(s.ans))+' →</a></div></div>'+
    '<div class="g-done">Come back tomorrow for a new country.<br>Your passport: <b>'+Object.keys(STATE.passport).length+'</b> of 197 collected.</div>';
  window.WMTG._stShareText="🎧 Sound Trip #"+dayNumber()+"\n"+cname(s.ans)+" — "+s.grid+" "+(s.win?s.tries+"/5":"X/5")+"\nworldmixtape.com/games";
}
window.WMTG.stShare=function(){copyShare(window.WMTG._stShareText||"");};

/* ==================================================================
   GAME 2 — TIME MACHINE
   ================================================================== */
var TM={};
function startTimeMachine(){
  var rng=rngFor("timemachine");
  var codes=Object.keys(window.COUNTRIES).filter(function(c){return tracksOf(c).length>0;}).sort();
  var c=pick(codes,rng),track=pick(tracksOf(c),rng),start=15+Math.floor(rng()*35);
  var decsPresent={};codes.forEach(function(cc){tracksOf(cc).forEach(function(t){decsPresent[t.decade]=1;});});
  var timeline=DECADE_ORDER.filter(function(d){return decsPresent[d];});
  TM={cc:c,track:track,start:start,timeline:timeline,ansIdx:timeline.indexOf(track.decade),guesses:[],done:false};
  var pt=playedToday("timemachine");
  if(pt){TM.done=true;renderTMReveal(pt.summary);return;}
  renderTM();
}
function renderTM(){
  var body=document.getElementById("tm-body");
  var chips=TM.timeline.map(function(d,i){
    var gi=TM.guesses.filter(function(g){return g.d===d;})[0];
    var cls="";if(gi){cls=gi.correct?" right":(i<TM.ansIdx?" low":" high");}
    return '<button class="g-dec'+cls+'" '+(TM.done||gi?"disabled":"")+' onclick="WMTG.tmGuess(\''+d+'\')">'+decLabel(d)+'</button>';
  }).join("");
  var last=TM.guesses[TM.guesses.length-1];
  var fb=last?(last.correct?'<div class="g-hint" style="color:var(--lime)">✓ that\'s it!</div>':'<div class="g-hint">'+(TM.timeline.indexOf(last.d)<TM.ansIdx?'⬆️ later than that':'⬇️ earlier than that')+' · '+(3-TM.guesses.length)+' left</div>'):'<div class="g-hint">Tap the decade you think it\'s from · 3 guesses</div>';
  body.innerHTML=
    '<div class="g-player" id="tm-player"><button class="g-play" id="tm-play" style="background:var(--cyan)" onclick="WMTG.tmPlay()">▶</button><div class="g-eq">'+eqBars()+'</div><div class="g-hint">A song from somewhere in the world — but <b>when</b>?</div></div>'+
    '<div class="g-decades">'+chips+'</div>'+fb;
}
window.WMTG.tmPlay=function(){var pl=document.getElementById("tm-player"),btn=document.getElementById("tm-play");if(playedState()){pauseVid();pl.classList.remove("playing");btn.textContent="▶";}else{playVid(TM.track.ytId,TM.start);pl.classList.add("playing");btn.textContent="❚❚";}};
window.WMTG.tmGuess=function(d){if(TM.done)return;if(TM.guesses.some(function(g){return g.d===d;}))return;var correct=d===TM.track.decade;TM.guesses.push({d:d,correct:correct});if(correct){finishTM(true);}else if(TM.guesses.length>=3){finishTM(false);}else renderTM();};
function tmGrid(){return TM.guesses.map(function(g){return g.correct?"🟩":(TM.timeline.indexOf(g.d)<TM.ansIdx?"🟧":"🟪");}).join("");}
function finishTM(win){TM.done=true;var s={win:win,cc:TM.cc,decade:TM.track.decade,year:TM.track.year,title:TM.track.title,artist:TM.track.artist,ytId:TM.track.ytId,start:TM.start,grid:tmGrid(),tries:TM.guesses.length};recordPlay("timemachine",s);renderTMReveal(s);}
function renderTMReveal(s){
  TM.track=TM.track||{ytId:s.ytId};TM.start=s.start;
  var body=document.getElementById("tm-body");
  body.innerHTML=
    '<div class="g-reveal" style="border-color:var(--cyan)"><div class="badge'+(s.win?"":" miss")+'" style="color:var(--cyan)">'+(s.win?"✓ Solved in "+s.tries+"!":"Today\'s answer")+'</div>'+
    '<div class="g-answer">'+flagImg(s.cc)+'<div><div class="a-nm">'+decLabel(s.decade)+(yearFits(s.year,s.decade)?' · '+s.year:"")+'</div><div class="a-sub">'+esc(s.title)+' · '+esc(s.artist)+' · '+esc(cname(s.cc))+'</div></div></div>'+
    '<div class="g-lesson">You just heard how '+esc(cname(s.cc))+' sounded in the '+decLabel(s.decade)+'. Music changes with its time — instruments, recording, and the world around it all leave fingerprints.</div>'+
    '<div class="g-player" id="tm-player" style="margin-bottom:12px"><button class="g-play" id="tm-play" style="background:var(--cyan)" onclick="WMTG.tmPlay()">▶</button><div class="g-eq">'+eqBars()+'</div><div class="g-hint">Hear the full song</div></div>'+
    '<div class="g-sharegrid">'+s.grid+'</div><div class="g-sharecap">Time Machine #'+dayNumber()+' · '+s.tries+"/3"+'</div>'+
    '<div class="g-btns"><button class="g-btn p" style="background:var(--cyan)" onclick="WMTG.tmShare()">Share</button><a class="g-btn s" href="/">Explore '+esc(cname(s.cc))+' →</a></div></div>'+
    '<div class="g-done">Come back tomorrow for a new mystery track.</div>';
  window.WMTG._tmShareText="🕰️ Time Machine #"+dayNumber()+"\n"+s.grid+" "+(s.win?s.tries+"/3":"X/3")+"\nworldmixtape.com/games";
}
window.WMTG.tmShare=function(){copyShare(window.WMTG._tmShareText||"");};

/* ==================================================================
   GAME 3 — CULTURE CLUSTERS
   ================================================================== */
var CL={};
var CL_COLORS=["🟩","🟪","🟦","🟧"];
function startClusters(){
  var rng=rngFor("clusters");
  var codes=Object.keys(window.COUNTRIES).filter(function(c){return artistsOf(c).length>=4;}).sort();
  var chosen=shuffle(codes,rng).slice(0,4);
  var groups=chosen.map(function(c){return {cc:c,artists:shuffle(artistsOf(c),rng).slice(0,4)};});
  var tiles=[];groups.forEach(function(g,gi){g.artists.forEach(function(a){tiles.push({a:a,g:gi,cc:g.cc});});});
  tiles=shuffle(tiles,rng);
  CL={groups:groups,tiles:tiles,sel:[],solved:[],lives:4,done:false,history:[]};
  var pt=playedToday("clusters");
  if(pt){CL.done=true;renderCLReveal(pt.summary);return;}
  renderCL();
}
function renderCL(){
  var body=document.getElementById("cl-body");
  var solvedHtml=CL.solved.map(function(gi){var g=CL.groups[gi];var col=["#c6ff00","#b388ff","#00e5ff","#ff6d00"][gi%4];return '<div class="g-solved" style="background:'+col+'"><h4>'+flagImg(g.cc)+esc(cname(g.cc))+'</h4><p>'+g.artists.map(esc).join(" · ")+'</p></div>';}).join("");
  var grid=CL.tiles.map(function(t,i){if(CL.solved.indexOf(t.g)>=0)return "";var sel=CL.sel.indexOf(i)>=0;return '<button class="g-tile'+(sel?" sel":"")+'" onclick="WMTG.clTap('+i+')">'+esc(t.a)+'</button>';}).join("");
  var lives="";for(var i=0;i<4;i++)lives+=i<CL.lives?"🟢":"⚫";
  body.innerHTML=
    '<p class="g-intro" style="margin:0 0 12px">Find the <b>4 countries</b> hiding here. Tap 4 artists you think share a homeland, then submit.</p>'+
    solvedHtml+
    '<div class="g-grid">'+grid+'</div>'+
    '<div class="g-lives">Guesses left: '+lives+'</div>'+
    '<div class="g-btns"><button class="g-btn s" onclick="WMTG.clClear()" style="flex:0 0 auto;padding:12px 16px">Clear</button><button class="g-btn p" style="background:var(--lime)" onclick="WMTG.clSubmit()">Submit (4)</button></div>';
}
window.WMTG.clTap=function(i){if(CL.done)return;var k=CL.sel.indexOf(i);if(k>=0)CL.sel.splice(k,1);else if(CL.sel.length<4)CL.sel.push(i);renderCL();};
window.WMTG.clClear=function(){CL.sel=[];renderCL();};
window.WMTG.clSubmit=function(){
  if(CL.done||CL.sel.length!==4)return;
  var gs=CL.sel.map(function(i){return CL.tiles[i].g;});
  CL.history.push(gs.slice());
  var g0=gs[0],all=gs.every(function(g){return g===g0;});
  if(all){CL.solved.push(g0);CL.sel=[];if(CL.solved.length===4)finishCL(true);else renderCL();}
  else{CL.lives--;toast("Not quite — "+CL.lives+" left");CL.sel=[];if(CL.lives<=0)finishCL(false);else renderCL();}
};
function clGrid(){return CL.history.map(function(row){return row.map(function(g){return CL_COLORS[g%4];}).join("");}).join("\n");}
function finishCL(win){CL.done=true;var s={win:win,solved:CL.solved.length,grid:clGrid(),groups:CL.groups.map(function(g){return {cc:g.cc,artists:g.artists};})};CL.solved.forEach(function(gi){stamp(CL.groups[gi].cc);});recordPlay("clusters",s);renderCLReveal(s);}
function renderCLReveal(s){
  var body=document.getElementById("cl-body");
  var cards=s.groups.map(function(g,gi){var col=["#c6ff00","#b388ff","#00e5ff","#ff6d00"][gi%4];var lesson=(window.COUNTRY_MUSIC&&window.COUNTRY_MUSIC[g.cc]&&window.COUNTRY_MUSIC[g.cc][0])||"";var snip=lesson.split(". ").slice(0,1).join(". ");if(snip&&!/[.!?]$/.test(snip))snip+=".";return '<div class="g-solved" style="background:'+col+';margin-bottom:10px"><h4>'+flagImg(g.cc)+esc(cname(g.cc))+'</h4><p>'+g.artists.map(esc).join(" · ")+'</p>'+(snip?'<p style="margin-top:6px;opacity:.85">'+esc(snip)+'</p>':"")+'</div>';}).join("");
  body.innerHTML=
    '<div class="g-reveal" style="border-color:var(--lime)"><div class="badge'+(s.win?"":" miss")+'">'+(s.win?"✓ All four! Perfect trip.":"You found "+s.solved+" of 4")+'</div>'+cards+
    '<div class="g-sharegrid" style="font-size:18px;letter-spacing:2px;white-space:pre">'+esc(s.grid)+'</div><div class="g-sharecap">Culture Clusters #'+dayNumber()+'</div>'+
    '<div class="g-btns"><button class="g-btn p" onclick="WMTG.clShare()">Share</button><a class="g-btn s" href="/">Explore these countries →</a></div></div>'+
    '<div class="g-done">Come back tomorrow for four new countries.</div>';
  window.WMTG._clShareText="🧩 Culture Clusters #"+dayNumber()+"\n"+s.grid+"\nworldmixtape.com/games";
}
window.WMTG.clShare=function(){copyShare(window.WMTG._clShareText||"");};

/* ---------------- boot ---------------- */
function boot(){loadAtlas();renderHub();var dn=document.querySelectorAll(".g-dn");for(var i=0;i<dn.length;i++)dn[i].textContent=dayNumber();}
if(document.readyState!=="loading")boot();else document.addEventListener("DOMContentLoaded",boot);

})();
