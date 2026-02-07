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

function newQuestion() {
  answeredPlayers.clear();
  correctPlayers.clear();

  currentQuestion =
    questions[Math.floor(Math.random() * questions.length)];

  timeLeft = QUESTION_TIME;

  broadcast({
    type: "question",
    question: currentQuestion.question,
    image: currentQuestion.image,
    time: QUESTION_TIME
  });

  clearInterval(timer);

  timer = setInterval(() => {
    timeLeft--;

    broadcast({ type: "timer", time: timeLeft });

    if (timeLeft <= 0)
      newQuestion();

  }, 1000);
}

wss.on("connection", ws => {

  players.set(ws, {
    name: "Jogador",
    score: 0
  });

  sendRanking();

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "setName") {
      players.get(ws).name = data.name || "Jogador";
      sendRanking();
    }

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
    }
  });

  ws.on("close", () => {
    players.delete(ws);
    sendRanking();
  });
});

newQuestion();

console.log("Servidor rodando em ws://localhost:3000");
