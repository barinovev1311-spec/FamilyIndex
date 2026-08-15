// server.js — статика + API семейного архива FamilyIndex.
//
// Данные, которые Марина добавляет через админку (люди, связи, фото,
// заметки, статусы расследования, кандидаты), хранятся здесь, на
// сервере, в файле data/overlay.json — их видят все, кто заходит на
// сайт.
//
// ВАЖНО про постоянство при деплое (см. README): на бесплатных тарифах
// многих хостингов диск при каждом передеплое пересоздаётся с нуля.
// Подключите постоянный диск (у Railway — Volume), сервер сам найдёт
// его через RAILWAY_VOLUME_MOUNT_PATH.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const researchService = require("./research-service");
const { isConfigured: aiConfigured } = require("./ai-service");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Skryabin1990";
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data");
const SEED_PATH = path.join(ROOT, "data", "seed.json");
const OVERLAY_PATH = path.join(DATA_DIR, "overlay.json");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

function emptyOverlay() {
  return { addedPersons: [], addedRelationships: [], edits: {}, relationshipEdits: {}, deleted: [], investigationStatuses: {}, notes: [], candidates: [] };
}

function ensureOverlay() {
  const dirExistedBefore = fs.existsSync(DATA_DIR);
  if (!dirExistedBefore) fs.mkdirSync(DATA_DIR, { recursive: true });
  const fileExistedBefore = fs.existsSync(OVERLAY_PATH);
  if (!fileExistedBefore) fs.writeFileSync(OVERLAY_PATH, JSON.stringify(emptyOverlay(), null, 2));
  return { dirExistedBefore, fileExistedBefore };
}
function readOverlay() {
  ensureOverlay();
  try {
    const raw = JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8"));
    // подстраховка для overlay.json, записанных до появления новых полей
    return { ...emptyOverlay(), ...raw };
  } catch { return emptyOverlay(); }
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

// ------------------------------------------------------ объединённое состояние (для AI-контекста)
function mergedState() {
  const seed = readSeed();
  const overlay = readOverlay();
  const persons = [...seed.persons, ...overlay.addedPersons]
    .filter((p) => !overlay.deleted.includes(p.id))
    .map((p) => (overlay.edits[p.id] ? { ...p, ...overlay.edits[p.id] } : p));
  const relationships = [...seed.relationships, ...overlay.addedRelationships]
    .filter((r) => !overlay.deleted.includes(r.id))
    .map((r) => (overlay.relationshipEdits[r.id] ? { ...r, ...overlay.relationshipEdits[r.id] } : r));
  return { persons, relationships, overlay, seed };
}
function getPerson(state, id) { return state.persons.find((p) => p.id === id); }
function relativesOf(state, id) {
  const out = [];
  state.relationships.forEach((r) => {
    if (r.type === "parent" && r.b === id) out.push({ role: "родитель", person: getPerson(state, r.a) });
    if (r.type === "parent" && r.a === id) out.push({ role: "ребёнок", person: getPerson(state, r.b) });
    if (r.type === "spouse" && (r.a === id || r.b === id)) out.push({ role: "супруг(а)", person: getPerson(state, r.a === id ? r.b : r.a) });
    if (r.type === "sibling" && (r.a === id || r.b === id)) out.push({ role: "брат/сестра", person: getPerson(state, r.a === id ? r.b : r.a) });
  });
  return out.filter((x) => x.person);
}

function sendAiError(res, err) {
  console.error("AI error:", err.code || "", err.message);
  if (err.code === "AI_NOT_CONFIGURED") return sendJSON(res, 503, { error: "ai_not_configured", message: err.message });
  return sendJSON(res, 502, { error: "ai_failed", message: err.message });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  // ---------------------------------------------------------------- базовое состояние
  if (p === "/api/state" && req.method === "GET") {
    return sendJSON(res, 200, { seed: readSeed(), overlay: readOverlay(), aiConfigured: aiConfigured() });
  }
  if (p === "/api/auth" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: "bad json" });
      sendJSON(res, 200, { ok: checkAuth(body) });
    });
  }

  // ---------------------------------------------------------------- люди
  if (p === "/api/person" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const person = { id: uid("p"), firstName: "", middleName: "", lastName: "", maidenName: "",
        gender: "unknown", isLiving: true, birth: { mode: "unknown" }, death: { mode: "unknown" },
        birthPlace: "", deathPlace: "", occupation: "", bio: "", notes: "", photos: [], nameVariants: [],
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

  // ---------------------------------------------------------------- связи
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
  const relIdMatch = p.match(/^\/api\/relationship\/([^/]+)$/);
  if (relIdMatch && req.method === "PUT") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      overlay.relationshipEdits[relIdMatch[1]] = { ...(overlay.relationshipEdits[relIdMatch[1]] || {}), ...body.patch };
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }

  // ---------------------------------------------------------------- точки расследования (статусы пробелов)
  const investMatch = p.match(/^\/api\/investigation\/([^/]+)\/([^/]+)$/);
  if (investMatch && req.method === "PUT") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const key = `${investMatch[1]}:${investMatch[2]}`;
      overlay.investigationStatuses[key] = { status: body.status, updatedAt: new Date().toISOString() };
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }

  // ---------------------------------------------------------------- заметки
  if (p === "/api/note" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const note = { id: uid("n"), targetType: body.targetType, targetId: body.targetId, noteType: body.noteType || "general", text: body.text || "", createdAt: new Date().toISOString() };
      overlay.notes.push(note);
      writeOverlay(overlay);
      sendJSON(res, 200, { note, overlay });
    });
  }
  const noteMatch = p.match(/^\/api\/note\/([^/]+)$/);
  if (noteMatch && req.method === "DELETE") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      overlay.notes = overlay.notes.filter((n) => n.id !== noteMatch[1]);
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }

  // ---------------------------------------------------------------- кандидаты (раздел «Расследование»)
  if (p === "/api/candidate" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const c = { id: uid("cand"), personId: body.personId || null, gapType: body.gapType || null,
        name: body.name || "", birthYear: body.birthYear || "", deathYear: body.deathYear || "", place: body.place || "",
        assumedRelation: body.assumedRelation || "", foundInfo: body.foundInfo || "", sources: body.sources || [],
        matchingFacts: [], contradictions: [], matchStrength: null, aiExplanation: "",
        notes: body.notes || "", status: "to_check", createdAt: new Date().toISOString() };
      overlay.candidates.push(c);
      writeOverlay(overlay);
      sendJSON(res, 200, { candidate: c, overlay });
    });
  }
  const candMatch = p.match(/^\/api\/candidate\/([^/]+)$/);
  if (candMatch && req.method === "PUT") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const overlay = readOverlay();
      const idx = overlay.candidates.findIndex((c) => c.id === candMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: "not_found" });
      overlay.candidates[idx] = { ...overlay.candidates[idx], ...body.patch, updatedAt: new Date().toISOString() };
      writeOverlay(overlay);
      sendJSON(res, 200, { overlay });
    });
  }

  if (p === "/api/reset" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      const empty = emptyOverlay();
      writeOverlay(empty);
      sendJSON(res, 200, { overlay: empty });
    });
  }

  // ---------------------------------------------------------------- AI (ResearchService поверх DeepSeek)
  if (p === "/api/ai/search-strategies" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const state = mergedState();
        const person = getPerson(state, body.personId);
        if (!person) return sendJSON(res, 404, { error: "person_not_found" });
        const notesText = state.overlay.notes
          .filter((n) => (n.targetType === "person" && n.targetId === person.id) || (n.targetType === "investigation" && n.targetId.startsWith(person.id + ":")))
          .map((n) => `[${n.noteType}] ${n.text}`).join("\n");
        const result = await researchService.generateSearchStrategies(person, relativesOf(state, person.id), notesText);
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/analyze-tree" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const result = await researchService.analyzeTreeNarrative(body.stats || {}, body.topGaps || []);
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/compare-candidate" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const state = mergedState();
        const person = getPerson(state, body.personId);
        if (!person) return sendJSON(res, 404, { error: "person_not_found" });
        const result = await researchService.compareCandidate(person, body.candidate);
        if (body.candidateId) {
          const overlay = readOverlay();
          const idx = overlay.candidates.findIndex((c) => c.id === body.candidateId);
          if (idx !== -1) {
            overlay.candidates[idx] = { ...overlay.candidates[idx], matchStrength: result.matchStrength, matchingFacts: result.matchingFacts || [], contradictions: result.contradictions || [], aiExplanation: result.explanation || "" };
            writeOverlay(overlay);
          }
        }
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/dossier" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const state = mergedState();
        const person = getPerson(state, body.personId);
        if (!person) return sendJSON(res, 404, { error: "person_not_found" });
        const result = await researchService.generateDossier(person, relativesOf(state, person.id), body.style || "factual");
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/surname" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const result = await researchService.explainSurname(body.surname, body.familyContext || "");
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/historical-context" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const state = mergedState();
        const person = getPerson(state, body.personId);
        if (!person) return sendJSON(res, 404, { error: "person_not_found" });
        const result = await researchService.historicalContextFor(person, body.yearFrom, body.yearTo);
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
    });
  }

  if (p === "/api/ai/analyze-branch" && req.method === "POST") {
    return readBody(req, async (err, body) => {
      if (err || !checkAuth(body)) return sendJSON(res, 401, { error: "unauthorized" });
      try {
        const state = mergedState();
        const persons = (body.personIds || []).map((id) => getPerson(state, id)).filter(Boolean);
        const ctx = persons.map((p) => `${[p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ")}`).join("\n");
        const result = await researchService.analyzeBranch(body.branchLabel || "", ctx);
        sendJSON(res, 200, result);
      } catch (e) { sendAiError(res, e); }
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

const { dirExistedBefore, fileExistedBefore } = ensureOverlay();

console.log("=== Диагностика хранения данных ===");
console.log("DATA_DIR (куда реально пишем overlay.json):", DATA_DIR);
console.log("Ручная переменная DATA_DIR задана:", process.env.DATA_DIR ? `да, "${process.env.DATA_DIR}"` : "нет");
console.log("Railway сообщил путь смонтированного Volume (RAILWAY_VOLUME_MOUNT_PATH):", process.env.RAILWAY_VOLUME_MOUNT_PATH || "НЕТ — Volume не подключён к этому сервису.");
console.log("Папка данных уже существовала до старта:", dirExistedBefore ? "ДА — хороший знак" : "НЕТ, создана только что");
console.log("Файл overlay.json уже существовал до старта:", fileExistedBefore ? "ДА — данные из прошлого раза найдены" : "НЕТ — создан заново пустым");
if (process.env.DATA_DIR && process.env.RAILWAY_VOLUME_MOUNT_PATH && process.env.DATA_DIR !== process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.log(`⚠ Ручная DATA_DIR ("${process.env.DATA_DIR}") НЕ совпадает с фактическим Volume ("${process.env.RAILWAY_VOLUME_MOUNT_PATH}"). Удалите переменную DATA_DIR — сервер сам подхватит путь.`);
}
console.log("DeepSeek (AiService):", aiConfigured() ? "настроен, ключ найден" : "НЕ настроен — задайте переменную окружения DEEPSEEK_API_KEY, чтобы заработали кнопки с 🤖");
console.log("=====================================");

server.listen(PORT, () => console.log(`FamilyIndex site + API listening on port ${PORT}`));
