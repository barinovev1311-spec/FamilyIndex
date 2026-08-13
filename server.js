// server.js — статика + API семейного архива.
//
// Данные, которые Марина добавляет через админку (люди, связи, фото),
// теперь хранятся не в браузере, а здесь, на сервере, в файле
// data/overlay.json — то есть их видят все, кто заходит на сайт.
//
// ВАЖНО про постоянство при деплое (см. README, раздел «Хранение
// данных»): на бесплатных тарифах многих хостингов диск при каждом
// передеплое пересоздаётся с нуля. Чтобы данные не терялись —
// подключите постоянный диск (у Railway это называется Volume) и
// смонтируйте его в /data, либо укажите переменную окружения DATA_DIR
// с путём к уже смонтированному постоянному диску.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Skryabin1990";
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const SEED_PATH = path.join(ROOT, "data", "seed.json"); // исходный снимок — не редактируется API
const OVERLAY_PATH = path.join(DATA_DIR, "overlay.json"); // правки — редактируется API

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

function ensureOverlay() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(OVERLAY_PATH)) {
    fs.writeFileSync(OVERLAY_PATH, JSON.stringify({ addedPersons: [], addedRelationships: [], edits: {}, deleted: [] }, null, 2));
  }
}
function readOverlay() {
  ensureOverlay();
  try { return JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8")); }
  catch { return { addedPersons: [], addedRelationships: [], edits: {}, deleted: [] }; }
}
function writeOverlay(overlay) {
  fs.writeFileSync(OVERLAY_PATH, JSON.stringify(overlay, null, 2));
}
function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
}
function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, cb) {
  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    try { cb(null, raw ? JSON.parse(raw) : {}); } catch (e) { cb(e); }
  });
}
function checkAuth(body) {
  return body && body.password === ADMIN_PASSWORD;
}

// находит relationship (в seed или overlay) по паре людей и типу — та же
// логика, что раньше жила в клиентском db.js, теперь общий источник истины
function findRelationshipId(overlay, seedRels, a, b, kind) {
  const all = [...seedRels, ...overlay.addedRelationships].filter((r) => !overlay.deleted.includes(r.id));
  let match;
  if (kind === "spouse" || kind === "sibling") {
    match = all.find((r) => r.type === kind && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
  } else if (kind === "parent-of-them") {
    match = all.find((r) => r.type === "parent" && r.a === b && r.b === a);
  } else if (kind === "parent-of-me") {
    match = all.find((r) => r.type === "parent" && r.a === a && r.b === b);
  }
  return match ? match.id : null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  // ---------------------------------------------------------------- API
  if (p === "/api/state" && req.method === "GET") {
    return sendJSON(res, 200, { seed: readSeed(), overlay: readOverlay() });
  }

  if (p === "/api/auth" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: "bad json" });
      sendJSON(res, 200, { ok: checkAuth(body) });
    });
  }

  if (p === "/api/person" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const person = { id: uid("p"), firstName: "", middleName: "", lastName: "", maidenName: "",
        gender: "unknown", isLiving: true, birth: { mode: "unknown" }, death: { mode: "unknown" },
        birthPlace: "", deathPlace: "", occupation: "", bio: "", notes: "", photo: "", nameVariants: [],
        verificationStatus: "unverified", createdAt: new Date().toISOString(), ...body.person };
      overlay.addedPersons.push(person);
      writeOverlay(overlay);
      sendJSON(res, 200, { person, overlay });
    });
  }

  const personMatch = p.match(/^\/api\/person\/([^/]+)$/);
  if (personMatch && req.method === "PUT") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const id = personMatch[1];
      overlay.edits[id] = { ...(overlay.edits[id] || {}), ...body.patch, updatedAt: new Date().toISOString() };
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }
  if (personMatch && req.method === "DELETE") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      overlay.deleted.push(personMatch[1]);
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }

  if (p === "/api/relationship" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const rel = { id: uid("r"), a: body.a, b: body.b, type: body.type, status: body.status || "confirmed", createdAt: new Date().toISOString() };
      overlay.addedRelationships.push(rel);
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }
  if (p === "/api/relationship" && req.method === "DELETE") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const seed = readSeed();
      const relId = findRelationshipId(overlay, seed.relationships, body.a, body.b, body.kind);
      if (relId) { overlay.deleted.push(relId); writeOverlay(overlay); }
      sendJSON(res, 200, { overlay, removed: !!relId });
    });
  }

  if (p === "/api/reset" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const empty = { addedPersons: [], addedRelationships: [], edits: {}, deleted: [] };
      writeOverlay(empty);
      sendJSON(res, 200, { overlay: empty });
    });
  }

  // ------------------------------------------------------------ static
  let filePath = p === "/" ? "/index.html" : decodeURIComponent(p);
  const full = path.normalize(path.join(ROOT, filePath));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, "index.html"), (err2, indexData) => {
        if (err2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

ensureOverlay();
server.listen(PORT, () => console.log(`Skryabin family site + API listening on port ${PORT}`));
