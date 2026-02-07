const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Servidor do quiz rodando.");
});

const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});

/* =========================
   SISTEMA DE SALAS
========================= */

const rooms = {};

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* =========================
   CONFIGURAÇÃO DO JOGO
========================= */

const QUESTION_TIME = 15;
const MAX_POINTS = 20;
const TARGET_SCORE = 120;

let players = new Map();
let timeLeft = QUESTION_TIME;
let currentQuestion = null;
let timer;

let answeredPlayers = new Set();
let correctPlayers = new Set();

const questions = [
  {
    question: "Quem é este jogador?",
    image: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Lionel_Messi_20180626.jpg",
    answers: ["lionel messi"],
    acceptedSingles: ["messi"]
  },
  {
    question: "Qual país venceu a Copa de 2018?",
    image: null,
    answers: ["franca", "frança"],
    acceptedSingles: []
  }
];

/* =========================
   UTILIDADES
========================= */

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function checkAnswer(ans, q) {
  ans = normalize(ans);

  for (let a of q.answers)
    if (ans === normalize(a)) return true;

  for (let s of q.acceptedSingles)
    if (ans === normalize(s)) return true;

  return false;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN)
      c.send(msg);
  });
}

function sendRanking() {
  const ranking = [...players.values()]
    .sort((a, b) => b.score - a.score);

  broadcast({
    type: "ranking",
    ranking
  });
}

/* =========================
   SISTEMA DE PERGUNTAS
========================= */

function newQuestion() {
  answeredPlayers.clear();
  correctPlayers.clear();

  currentQuestion =
    questions[Math.floor(Math.random() * questions.length)];

  timeLeft = QUESTION_TIME;

  broadcast({
    type: "question",
    question: currentQuestion.question,
    image: currentQuestion.image
  });

  clearInterval(timer);

  timer = setInterval(() => {
    timeLeft--;

    broadcast({ type: "timer", time: timeLeft });

    if (timeLeft <= 0) {
  clearInterval(timer);
  broadcast({ type: "round_end" });
}


  }, 1000);
}

/* =========================
   CONEXÕES
========================= */

wss.on("connection", ws => {

  players.set(ws, {
    name: "Jogador",
    score: 0
  });

  sendRanking();

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    /* ===== Criar sala ===== */
    if (data.type === "create_room") {
      let code;
      do {
        code = generateRoomCode();
      } while (rooms[code]);

      rooms[code] = {
        host: ws,
        players: [ws],
        theme: data.theme,
        scoreGoal: data.scoreGoal
      };

      ws.roomCode = code;

      ws.send(JSON.stringify({
        type: "room_created",
        code
      }));

      ws.send(JSON.stringify({
        type: "you_are_host"
      }));

      return;
    }

    /* ===== Entrar em sala ===== */
    if (data.type === "join_room") {
      const room = rooms[data.code];

      if (!room) {
        ws.send(JSON.stringify({
          type: "room_not_found"
        }));
        return;
      }

      room.players.push(ws);
      ws.roomCode = data.code;

      ws.send(JSON.stringify({
        type: "room_joined",
        code: data.code
      }));

      return;
    }

    /* ===== Definir nome ===== */
    if (data.type === "setName") {
      players.get(ws).name = data.name || "Jogador";
      sendRanking();
      return;
    }

    /* ===== Iniciar jogo (host) ===== */
    if (data.type === "start_game") {
      const room = rooms[ws.roomCode];
      if (!room) return;

      if (room.host === ws)
        newQuestion();

      return;
    }

    /* ===== Resposta ===== */
    if (data.type === "answer") {

      if (answeredPlayers.has(ws)) return;
      answeredPlayers.add(ws);

      if (checkAnswer(data.answer, currentQuestion)) {

        if (correctPlayers.has(ws)) return;
        correctPlayers.add(ws);

        let points =
          Math.round(MAX_POINTS * (timeLeft / QUESTION_TIME));

        let p = players.get(ws);
        p.score += points;

        sendRanking();

        if (p.score >= TARGET_SCORE) {
          broadcast({ type: "end" });

          players.forEach(p => p.score = 0);
          sendRanking();
        }
      }

      return;
    }
  });

  /* ===== Jogador sai ===== */
  ws.on("close", () => {
    players.delete(ws);

    if (ws.roomCode && rooms[ws.roomCode]) {
      const room = rooms[ws.roomCode];

      room.players =
        room.players.filter(p => p !== ws);

      if (room.host === ws && room.players.length > 0)
        room.host = room.players[0];

      if (room.players.length === 0)
        delete rooms[ws.roomCode];
    }

    sendRanking();
  });
});
