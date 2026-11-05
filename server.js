
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static("public"));

function makeCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function getActivePlayers(room) {
  return room.players.filter(p => !p.solved && !p.eliminated);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    currentTurn: room.currentTurn,
    question: room.question,
    message: room.message,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      solved: p.solved,
      eliminated: p.eliminated,
      guessesLeft: p.guessesLeft
    })),
    ranking: room.ranking
  };
}

function sendRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));

  room.players.forEach(player => {
    const others = room.players
      .filter(p => p.id !== player.id)
      .map(p => ({ name: p.name, number: p.number }));

    io.to(player.id).emit("game:private", {
      myNumber: room.status === "playing" || room.status === "finished"
        ? player.number : null,
      others
    });
  });
}

function finishGame(room) {
  room.status = "finished";
  room.currentTurn = null;
  room.message = "游戏结束！全部数字已经揭晓。";

  room.ranking = [...room.players]
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return 0;
    })
    .map(p => ({
      name: p.name,
      number: p.number,
      rank: p.rank || null,
      status: p.solved ? "已猜中" : "未完成"
    }));

  sendRoom(room);
}

function checkFinished(room) {
  if (getActivePlayers(room).length === 0) {
    finishGame(room);
    return true;
  }
  return false;
}

function advanceTurn(room) {
  if (checkFinished(room)) return;

  const active = getActivePlayers(room);
  if (!active.length) return;

  const currentIndex = room.players.findIndex(
    p => p.id === room.currentTurn
  );

  for (let step = 1; step <= room.players.length; step++) {
    const index = (currentIndex + step + room.players.length)
      % room.players.length;
    const candidate = room.players[index];

    if (!candidate.solved && !candidate.eliminated) {
      room.currentTurn = candidate.id;
      return;
    }
  }

  room.currentTurn = active[0].id;
}

io.on("connection", socket => {

  socket.on("room:create", ({ name } = {}, callback) => {
    name = String(name || "").trim().slice(0, 12);

    if (!name) {
      return callback?.({ ok: false, error: "请输入昵称。" });
    }

    const code = makeCode();

    const player = {
      id: socket.id,
      name,
      number: null,
      guessesLeft: 3,
      solved: false,
      eliminated: false,
      ready: true,
      rank: null
    };

    const room = {
      code,
      hostId: socket.id,
      status: "lobby",
      players: [player],
      currentTurn: null,
      question: null,
      message: "等待其他玩家加入，五人到齐后即可开始。",
      ranking: []
    };

    rooms.set(code, room);
    socket.join(code);
    sendRoom(room);

    callback?.({ ok: true, playerId: socket.id, code });
  });

  socket.on("room:join", ({ code, name } = {}, callback) => {
    code = String(code || "").trim();
    name = String(name || "").trim().slice(0, 12);

    const room = rooms.get(code);

    if (!name) {
      return callback?.({ ok: false, error: "请输入昵称。" });
    }

    if (!room) {
      return callback?.({ ok: false, error: "房间不存在，请检查房间号。" });
    }

    if (room.status !== "lobby") {
      return callback?.({ ok: false, error: "游戏已经开始，无法加入。" });
    }

    if (room.players.length >= 5) {
      return callback?.({ ok: false, error: "房间已经满员。" });
    }

    if (room.players.some(p => p.name === name)) {
      return callback?.({ ok: false, error: "这个昵称已经被使用，请换一个。" });
    }

    room.players.push({
      id: socket.id,
      name,
      number: null,
      guessesLeft: 3,
      solved: false,
      eliminated: false,
      ready: true,
      rank: null
    });

    socket.join(code);
    room.message = `已有 ${room.players.length}/5 名玩家加入。`;

    sendRoom(room);
    callback?.({ ok: true, playerId: socket.id, code });
  });

  socket.on("room:start", callback => {
    const room = [...rooms.values()].find(r =>
      r.players.some(p => p.id === socket.id)
    );

    if (!room) {
      return callback?.({ ok: false, error: "没有找到你的房间。" });
    }

    if (room.hostId !== socket.id) {
      return callback?.({ ok: false, error: "只有房主可以开始游戏。" });
    }

    if (room.status !== "lobby" || room.players.length !== 5) {
      return callback?.({ ok: false, error: "需要五名玩家全部到齐才能开始。" });
    }

    const numbers = [];
    while (numbers.length < 5) {
      const n = Math.floor(Math.random() * 100) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }

    room.players.forEach((p, i) => {
      p.number = numbers[i];
      p.guessesLeft = 3;
      p.solved = false;
      p.eliminated = false;
      p.rank = null;
    });

    room.status = "playing";
    room.currentTurn = room.players[0].id;
    room.question = null;
    room.message = "游戏开始！每个人只能看到其他四位玩家的数字。";

    sendRoom(room);
    callback?.({ ok: true });
  });

  socket.on("game:ask", ({ text } = {}, callback) => {
    const room = [...rooms.values()].find(r =>
      r.players.some(p => p.id === socket.id)
    );

    if (!room || room.status !== "playing") {
      return callback?.({ ok: false, error: "当前无法提问。" });
    }

    const player = room.players.find(p => p.id === socket.id);

    if (!player || player.solved || player.eliminated) {
      return callback?.({ ok: false, error: "你已经完成挑战，不能继续提问。" });
    }

    if (room.currentTurn !== socket.id) {
      return callback?.({ ok: false, error: "还没有轮到你提问。" });
    }

    text = String(text || "").trim().slice(0, 100);

    if (!text) {
      return callback?.({ ok: false, error: "请先输入问题。" });
    }

    room.question = {
      playerName: player.name,
      text
    };

    room.message = `${player.name} 已经提出问题，请其他玩家口头回答。`;

    advanceTurn(room);
    sendRoom(room);

    callback?.({ ok: true });
  });

  socket.on("game:guess", ({ value } = {}, callback) => {
    const room = [...rooms.values()].find(r =>
      r.players.some(p => p.id === socket.id)
    );

    if (!room || room.status !== "playing") {
      return callback?.({ ok: false, error: "当前无法竞猜。" });
    }

    const player = room.players.find(p => p.id === socket.id);

    if (!player || player.solved || player.eliminated) {
      return callback?.({ ok: false, error: "你已经完成挑战。" });
    }

    const guess = Number(value);

    if (!Number.isInteger(guess) || guess < 1 || guess > 100) {
      return callback?.({ ok: false, error: "请输入 1 到 100 之间的整数。" });
    }

    if (guess === player.number) {
      player.solved = true;
      player.rank = room.players.filter(p => p.solved).length;
      room.message = `${player.name} 猜中了自己的数字！`;

      if (room.currentTurn === socket.id) {
        advanceTurn(room);
      }

      checkFinished(room);
      sendRoom(room);

      return callback?.({
        ok: true,
        message: "恭喜你，猜中了！",
        guessesLeft: player.guessesLeft
      });
    }

    player.guessesLeft--;

    if (player.guessesLeft <= 0) {
      player.eliminated = true;
      room.message = `${player.name} 用完三次机会，已被淘汰。`;

      if (room.currentTurn === socket.id) {
        advanceTurn(room);
      }

      checkFinished(room);
      sendRoom(room);

      return callback?.({
        ok: true,
        message: "三次机会已经用完，你被淘汰了。",
        guessesLeft: 0
      });
    }

    const hint = guess < player.number ? "猜小了" : "猜大了";

    callback?.({
      ok: true,
      message: `很遗憾，${hint}。`,
      guessesLeft: player.guessesLeft
    });

    room.message = `${player.name} 进行了一次猜测。`;
    sendRoom(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index === -1) continue;

      if (room.status === "lobby") {
        room.players.splice(index, 1);

        if (room.players.length === 0) {
          rooms.delete(code);
          return;
        }

        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
        }

        room.message = "有玩家离开了房间。";
        sendRoom(room);
        return;
      }

      if (room.status === "playing") {
        const player = room.players[index];
        player.eliminated = true;
        player.guessesLeft = 0;

        room.message = `${player.name} 已离开游戏，视为淘汰。`;

        if (room.currentTurn === socket.id) {
          advanceTurn(room);
        }

        checkFinished(room);
        sendRoom(room);
        return;
      }
    }
  });

});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`数字盲盒服务器已启动，端口：${PORT}`);
});
