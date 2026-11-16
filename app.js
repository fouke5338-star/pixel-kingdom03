const socket = io();
const $ = id => document.getElementById(id);
let room = null, isHost = false, myRole = "player", myId = null, questionCount = 0;
let identity = null;
try { identity = JSON.parse(sessionStorage.getItem("pk_identity") || "null"); } catch { identity = null; }
const statNames = { money:"MONEY", happiness:"HAPPINESS", goodness:"GOODNESS", energy:"ENERGY", trust:"TRUST" };
const STAT_KEYS = ["money","happiness","goodness","energy","trust"];
function token() {
  if (window.crypto?.randomUUID) return crypto.randomUUID() + crypto.randomUUID();
  return Array.from({length:48},()=>Math.floor(Math.random()*16).toString(16)).join("");
}
function saveIdentity(value) { identity=value; sessionStorage.setItem("pk_identity",JSON.stringify(value)); }
function clearIdentity() { identity=null; sessionStorage.removeItem("pk_identity"); }
function toast(msg) { $("toast").textContent=msg; $("toast").classList.remove("hidden"); setTimeout(()=>$("toast").classList.add("hidden"),3200); }
function show(id) { document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active")); $("screen-"+id).classList.add("active"); }
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function addQuestion(data={}) {
  questionCount++;
  const n=questionCount, card=document.createElement("div");
  card.className="question-card";
  card.innerHTML=`<div class="qtop"><span>QUESTION ${n}</span><button class="back remove-q" type="button">REMOVE ×</button></div><input class="q-text" maxlength="500" placeholder="Write your question..." value="${esc(data.text||"")}"><div class="option-grid">${[0,1,2,3].map(i=>`<div class="option-line"><input type="radio" name="correct-${n}" value="${i}" ${data.correctIndex===i?"checked":i===0&&data.correctIndex==null?"checked":""}><input class="q-option" maxlength="160" placeholder="Answer ${String.fromCharCode(65+i)}" value="${esc(data.options?.[i]||"")}"></div>`).join("")}</div>`;
  card.querySelector(".remove-q").onclick=()=>{card.remove();renumber();};
  $("questions").append(card); renumber();
}
function renumber() {
  [...$("questions").children].forEach((c,i)=>c.querySelector(".qtop span").textContent=`QUESTION ${i+1}`);
  $("q-count").textContent=`${$("questions").children.length} QUESTION${$("questions").children.length===1?"":"S"}`;
}
$("create-open").onclick=()=>{show("create");if(!$("questions").children.length)addQuestion();};
$("join-open").onclick=()=>show("join");
document.querySelectorAll("[data-home]").forEach(b=>b.onclick=()=>show("home"));
$("add-question").onclick=()=>addQuestion();

$("create-submit").onclick=()=>{
  const questions=[...$("questions").children].map(c=>({
    text:c.querySelector(".q-text").value.trim(),
    options:[...c.querySelectorAll(".q-option")].map(x=>x.value.trim()),
    correctIndex:Number(c.querySelector('input[type=radio]:checked')?.value??0)
  }));
  const hostToken=token();
  socket.emit("room:create",{name:$("host-name").value.trim(),questions,intermissionSeconds:$("break-time").value,hostToken},res=>{
    if(!res?.ok)return toast(res?.error||"Could not create the room.");
    isHost=true;myRole="spectator";myId=null;
    saveIdentity({kind:"host",roomCode:res.code,token:hostToken});
    toast("Room created: "+res.code);show("lobby");if(room)renderRoom();
  });
};
$("join-submit").onclick=()=>{
  const playerToken=token();
  socket.emit("room:join",{name:$("join-name").value.trim(),code:$("join-code").value.trim(),role:"player",playerToken},res=>{
    if(!res?.ok)return toast(res?.error||"Could not join the room.");
    isHost=false;myRole=res.role;myId=playerToken;
    saveIdentity({kind:"player",roomCode:$("join-code").value.trim().toUpperCase(),token:playerToken});
    show("lobby");
  });
};
$("join-code").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("role-player").onclick=()=>setRole("player");
$("role-spectator").onclick=()=>setRole("spectator");
function setRole(role){if(isHost)return;myRole=role;socket.emit("player:role",{role});renderRole();}
function renderRole(){
  $("role-player").classList.toggle("selected",myRole==="player");
  $("role-spectator").classList.toggle("selected",myRole==="spectator");
  $("role-player").disabled=isHost;$("role-spectator").disabled=isHost;
}
$("start-game").onclick=()=>socket.emit("host:start");
$("host-next").onclick=()=>socket.emit("host:next");
$("result-next").onclick=()=>socket.emit("host:next");

socket.on("connect",()=>{
  if(identity) socket.emit("room:resume",identity,res=>{
    if(!res?.ok){clearIdentity();room=null;isHost=false;myId=null;toast(res?.error||"Session expired. Please join again.");show("home");return;}
    isHost=!!res.isHost;myRole=res.role;myId=res.isHost?null:res.token;
    toast("Reconnected to your room.");
  });
});
socket.on("disconnect",()=>{if(identity)toast("Connection lost. Reconnecting...");});
socket.on("connect_error",()=>toast("Unable to connect. Check your internet connection."));
socket.on("room:update",r=>{room=r;renderRoom();});
socket.on("room:closed",()=>{toast("The room is no longer available.");clearIdentity();room=null;show("home");});

function renderRoom(){
  if(!room)return;
  $("lobby-code").textContent=room.code;$("game-code").textContent=room.code;
  $("host-controls").classList.toggle("hidden",!isHost);
  $("player-count").textContent=room.players.filter(p=>p.role==="player").length+" PLAYERS";
  $("roster").innerHTML=room.players.map(p=>`<div class="roster-item"><span>${esc(p.name)} ${p.id===myId?"(YOU)":""} ${p.online?"":"· OFFLINE"}</span><small>${p.role.toUpperCase()}</small></div>`).join("")||'<div class="empty">Waiting for players to join...</div>';
  $("host-online-label").textContent=room.hostOnline?"HOST ONLINE":"HOST RECONNECTING";
  renderRole();
  if(room.status==="lobby"){show("lobby");return;}
  if(["playing","event_selection","intermission"].includes(room.status)){show("game");renderGame();return;}
  if(room.status==="results"){show("results");renderResults();}
}
function me(){return room?.players.find(p=>p.id===myId);}
function renderStats(){
  const p=me();
  $("stats").innerHTML=STAT_KEYS.map(k=>`<div class="stat"><span>${statNames[k]}</span><div class="bar"><i style="width:${Math.min(100,p?.stats[k]||0)}%"></i></div><b>${p?.stats[k]??"—"}</b></div>`).join("");
}
function timeLeft(){
  if(!room?.phaseEndsAt)return null;
  return Math.max(0,Math.ceil((room.phaseEndsAt-Date.now())/1000));
}
function renderTimer(){
  const left=timeLeft();
  $("phase-timer").classList.toggle("hidden",left===null);
  if(left!==null)$("phase-timer").textContent=`${left}s`;
}
setInterval(renderTimer,250);

function renderGame(){
  renderStats();
  $("host-bar").classList.toggle("hidden",!isHost);
  renderTimer();
  if(room.status==="intermission"){
    $("game-phase").textContent="ROUND BREAK";
    $("game-title").textContent="PREPARING THE NEXT QUESTION";
    $("question-area").innerHTML=`<p class="eyebrow">EVENT PHASE COMPLETE</p><div class="question-text">The next round will begin when the timer reaches zero.</div><p class="muted">${isHost?"You can start the next round early using the host button.":"Please wait for the next round."}</p>`;
    $("event-area").classList.add("hidden");
    $("host-next").textContent="START NEXT ROUND →";
    $("host-status").textContent="NEXT ROUND IN "+(timeLeft()??0)+" SECONDS";
    return;
  }
  $("game-phase").textContent=`ROUND ${room.round} / ${room.totalRounds}`;
  $("game-title").textContent=room.status==="event_selection"?"CITY EVENT PHASE":"A QUESTION FOR YOUR KINGDOM";
  $("host-next").textContent="NEXT ROUND →";
  const answered=room.answered.includes(myId);
  const correct=room.correctPlayers.includes(myId);
  const eventDone=room.eventSelections.includes(myId);
  if(isHost){
    $("question-area").innerHTML=`<p class="eyebrow">HOST OBSERVER VIEW</p><div class="question-text">${esc(room.question?.text||"")}</div><p class="muted">Answers received: ${room.answered.length} / ${room.players.filter(p=>p.role==="player").length}</p><p class="muted">${room.status==="event_selection"?"Event selection deadline: "+(timeLeft()??0)+" seconds.": "Waiting for all players to answer."}</p>`;
  } else if(myRole==="spectator"){
    $("question-area").innerHTML=`<p class="eyebrow">SPECTATOR VIEW</p><div class="question-text">${esc(room.question?.text||"")}</div><p class="muted">You are watching this match. You cannot answer after the game has started.</p>`;
  } else if(room.status==="playing" && !answered){
    $("question-area").innerHTML=`<p class="eyebrow">CHOOSE THE CORRECT ANSWER</p><div class="question-text">${esc(room.question?.text||"")}</div><div class="answer-grid">${room.question.options.map((o,i)=>`<button class="answer-btn" data-answer="${i}">${String.fromCharCode(65+i)}. ${esc(o)}</button>`).join("")}</div>`;
    document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("[data-answer]").forEach(x=>x.disabled=true);
      socket.emit("player:answer",{index:Number(b.dataset.answer)});
    });
  } else if(room.status==="event_selection" && correct && !eventDone){
    $("question-area").innerHTML=`<p class="eyebrow">CORRECT ANSWER!</p><div class="question-text">Choose one event to shape your city.</div><p class="muted">Time remaining: ${timeLeft()??0} seconds.</p>`;
  } else if(room.status==="event_selection" && correct && eventDone){
    $("question-area").innerHTML=`<p class="eyebrow">EVENT SELECTED</p><div class="question-text">Your city event has been applied.</div><p class="muted">Waiting for the other players...</p>`;
  } else if(answered){
    $("question-area").innerHTML=`<p class="eyebrow">${room.status==="event_selection"?"ANSWER INCORRECT":"ANSWER SUBMITTED"}</p><div class="question-text">Please wait for the next phase...</div><p class="muted">The game will continue when the current phase is complete.</p>`;
  }
  const ev=$("event-area");
  if(room.status==="event_selection" && correct && !eventDone && !isHost && myRole==="player"){
    ev.classList.remove("hidden");
    const choices=room.eventChoices[myId]||[];
    ev.innerHTML=`<p class="eyebrow">CITY EVENT SELECTION · ${timeLeft()??0}s LEFT</p><h3>CHOOSE ONE EVENT</h3><div class="event-options">${choices.map(e=>`<button class="event-choice" data-event="${e.id}"><b>${esc(e.title)}</b><div class="delta">${Object.entries(e.delta).map(([k,v])=>`<div class="${v<0?"negative":""}">${statNames[k]} ${v>0?"+":""}${v}</div>`).join("")}</div></button>`).join("")}</div>`;
    ev.querySelectorAll("[data-event]").forEach(b=>b.onclick=()=>{
      ev.querySelectorAll("[data-event]").forEach(x=>x.disabled=true);
      socket.emit("player:event",{eventId:Number(b.dataset.event)});
    });
  } else if(room.status==="event_selection" && !isHost){
    ev.classList.remove("hidden");
    ev.innerHTML=`<p class="eyebrow">EVENT PHASE</p><p class="muted">${correct?"Your event has been selected.":"You answered incorrectly, so there is no event to choose."} Waiting for the other players. ${timeLeft()??0}s remaining.</p>`;
  } else ev.classList.add("hidden");
  $("host-status").textContent=room.status==="event_selection"
    ? `EVENT PHASE · ${room.eventSelections.length} / ${room.correctPlayers.length} EVENTS CHOSEN`
    : `${room.answered.length} / ${room.players.filter(p=>p.role==="player").length} PLAYERS ANSWERED`;
}

function renderResults(){
  $("host-bar").classList.toggle("hidden",!isHost);
  const idx=room.resultIndex,cats=room.results.categories;
  $("result-next").disabled=!isHost;
  if(idx<cats.length){
    const c=cats[idx];
    $("results-title").textContent=statNames[c.key]+" RANKING";
    $("results-sub").textContent="Top 5 cities · Host controls the next reveal";
    $("result-content").innerHTML=c.rows.filter((r,i)=>i<5 || r.value===c.rows[4]?.value).map((r,i)=>`<div class="rank-row"><span class="rank-num">#${i+1}</span><span class="rank-name">${esc(r.name)}</span><span class="rank-value">${r.value} · ${r.points} PTS</span></div>`).join("")||'<p class="empty">No player results.</p>';
    $("result-host-status").textContent=`CATEGORY ${idx+1} OF 6`;
    $("result-next").textContent="NEXT CATEGORY →";
  } else if(idx===cats.length){
    $("results-title").textContent="TOTAL KINGDOM SCORE";
    $("results-sub").textContent="All five category scores combined";
    $("result-content").innerHTML=room.results.total.map((r,i)=>`<div class="rank-row"><span class="rank-num">#${r.rank}</span><span class="rank-name">${esc(r.name)}</span><span class="rank-value">${r.score} PTS</span></div>`).join("");
    $("result-host-status").textContent="FINAL RESULTS";
    $("result-next").textContent="FINISH";
  } else {
    $("results-title").textContent="THANK YOU, RULERS!";
    $("results-sub").textContent="The kingdom challenge is complete.";
    $("result-content").innerHTML='<div class="question-text" style="text-align:center">Well played, everyone.</div>';
    $("result-next").disabled=true;
    $("result-host-status").textContent="GAME COMPLETE";
  }
}
