const socket = io();
let myId = null, roomCode = null, roomState = null, privateState = null;
const $ = id => document.getElementById(id);
const sections = ["entry","lobby","game","result"];
function show(id){sections.forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),2600);}
function nickname(){return $("nickname").value.trim();}
function playerName(id){return roomState?.players.find(p=>p.id===id)?.name || "玩家";}
function renderPlayers(target, players, compact=false){
  $(target).innerHTML=players.map((p,i)=>`<div class="player"><div class="avatar">${p.name.slice(0,1)}</div><strong>${escapeHtml(p.name)}</strong><small>${p.solved?"已猜中":p.eliminated?"已淘汰":p.ready?"已加入":"等待中"}</small></div>`).join("");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("createBtn").onclick=()=>{
  if(!nickname()) return toast("请先输入昵称。");
  socket.emit("room:create",{name:nickname()},res=>{
    if(!res?.ok)return toast(res?.error||"创建失败");
    myId=res.playerId;roomCode=res.code;$("roomCode").textContent=roomCode;show("lobby");
  });
};
$("joinBtn").onclick=()=>{
  if(!nickname())return toast("请先输入昵称。");
  socket.emit("room:join",{code:$("roomInput").value,name:nickname()},res=>{
    if(!res?.ok)return toast(res?.error||"加入失败");
    myId=res.playerId;roomCode=res.code;$("roomCode").textContent=roomCode;show("lobby");
  });
};
$("copyBtn").onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>toast("房间号已复制")).catch(()=>toast("房间号："+roomCode));
$("startBtn").onclick=()=>socket.emit("room:start",res=>{if(!res?.ok)toast(res?.error||"暂时无法开始");});
$("askBtn").onclick=()=>{
  const text=$("questionInput").value.trim();
  socket.emit("game:ask",{text},res=>{if(!res?.ok)toast(res?.error||"提交失败");else $("questionInput").value="";});
};
$("guessBtn").onclick=()=>{
  const value=$("guessInput").value;
  socket.emit("game:guess",{value},res=>{
    if(!res?.ok)return toast(res?.error||"竞猜失败");
    $("guessFeedback").textContent=res.message+(res.guessesLeft!==undefined?` 还剩${res.guessesLeft}次机会。`:"");
    $("guessInput").value="";
  });
};
$("backBtn").onclick=()=>{location.reload();};

socket.on("room:update",room=>{
  roomState=room;
  if(room.status==="lobby"){
    show("lobby");$("roomCode").textContent=room.code;$("playerCount").textContent=`${room.players.length}/5`;
    renderPlayers("lobbyPlayers",room.players);$("lobbyMessage").textContent=room.message;
    $("startBtn").disabled=!(room.players.length===5 && room.hostId===myId);
    $("startBtn").textContent=room.players.length===5?"开始游戏":"等待五人到齐后开始";
  } else if(room.status==="playing"){
    show("game");
    const me=room.players.find(p=>p.id===myId);
    $("myName").textContent=me?.name||"";
    $("myStatus").textContent=me?.solved?"你已猜中，继续帮助其他玩家回答问题":me?.eliminated?"你已被淘汰，仍可帮助其他玩家回答":`剩余竞猜机会：${me?.guessesLeft ?? 3}`;
    $("turnLabel").textContent=room.currentTurn===myId?"轮到你提问":`当前提问：${playerName(room.currentTurn)}`;
    $("gameMessage").textContent=room.message||"";
    $("lastQuestion").textContent=room.question?`${room.question.playerName}：${room.question.text}（请其他玩家口头回答）`:"暂时还没有人提问";
    renderPlayers("gamePlayers",room.players,true);
    const my=room.players.find(p=>p.id===myId);
    const canAsk=room.currentTurn===myId && my && !my.solved && !my.eliminated;
    $("askBtn").disabled=!canAsk;
    $("questionInput").disabled=!canAsk;
    $("guessBtn").disabled=!my || my.solved || my.eliminated;
    $("guessInput").disabled=!my || my.solved || my.eliminated;
  } else if(room.status==="finished"){
    show("result");
    $("resultList").innerHTML=room.ranking.map(p=>`<div class="resultitem"><div><strong>${escapeHtml(p.name)}</strong><div class="muted">${p.rank?`第${p.rank}名`:(p.status||"未完成")}</div></div><strong>${p.number}</strong></div>`).join("");
  }
});
socket.on("game:private",data=>{
  privateState=data;
  if(data.myNumber!==null){
    $("myNumber").textContent=data.myNumber;
    $("otherNumbers").innerHTML=data.others.map(p=>`<div class="other"><span>${escapeHtml(p.name)}的数字</span><strong>${p.number}</strong></div>`).join("");
  }
});
socket.on("connect",()=>{});
