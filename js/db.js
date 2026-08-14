// db.js — данные семьи Скрябиных, теперь общие для всех посетителей.
// Источник правды — сервер (server.js + data/overlay.json). Браузер
// только запрашивает и отправляет изменения через /api/*.

import { computeAllRelations } from "./relations.js";

let seed = null;
let overlay = null;
let ready = false;
let aiConfigured = false;
const listeners = new Set();
let password = null; // хранится только в памяти вкладки, не в localStorage

function buildState() {
  if (!seed || !overlay) return { persons: [], relationships: [], marinaId: null, husbandId: null, researchNotes: {} };
  const persons = [...seed.persons, ...overlay.addedPersons]
    .filter((p) => !overlay.deleted.includes(p.id))
    .map((p) => (overlay.edits[p.id] ? { ...p, ...overlay.edits[p.id] } : p));
  const relationships = [...seed.relationships, ...overlay.addedRelationships].filter((r) => !overlay.deleted.includes(r.id));
  const relMap = computeAllRelations(persons, relationships, seed.marinaId, seed.husbandId);
  persons.forEach((p) => { p._meta = relMap.get(p.id) || { generation: null, side: null, relationToMarina: "родство не установлено" }; });
  return { persons, relationships, marinaId: seed.marinaId, husbandId: seed.husbandId, researchNotes: seed.researchNotes };
}

async function api(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === "unauthorized") throw new Error("unauthorized");
    const e = new Error(err.message || `Ошибка сервера (${res.status})`);
    e.code = err.error;
    throw e;
  }
  return res.json();
}

async function loadInitial() {
  const data = await api("/api/state", "GET");
  seed = data.seed;
  overlay = data.overlay;
  aiConfigured = !!data.aiConfigured;
  ready = true;
  listeners.forEach((fn) => fn());
}

async function refreshOverlay() {
  try {
    const data = await api("/api/state", "GET");
    const changed = JSON.stringify(data.overlay) !== JSON.stringify(overlay);
    seed = data.seed;
    overlay = data.overlay;
    aiConfigured = !!data.aiConfigured;
    if (changed) listeners.forEach((fn) => fn());
  } catch (e) { /* тихо игнорируем сбой фонового опроса */ }
}

const initialLoad = loadInitial();
setInterval(refreshOverlay, 20000); // остальные посетители видят правки Марины в течение ~20 секунд

export const DB = {
  ready() { return initialLoad; },
  isReady() { return ready; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get() { return buildState(); },
  async refresh() {
    const data = await api("/api/state", "GET");
    seed = data.seed; overlay = data.overlay; aiConfigured = !!data.aiConfigured;
    listeners.forEach((fn) => fn());
  },
  getPerson(id) { return this.get().persons.find((p) => p.id === id) || null; },

  setPassword(pass) { password = pass; },
  async checkPassword(pass) {
    const r = await api("/api/auth", "POST", { password: pass });
    if (r.ok) password = pass;
    return r.ok;
  },
  hasSession() { return !!password; },

  async addPerson(data) {
    const r = await api("/api/person", "POST", { password, person: data });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
    return r.person;
  },
  async updatePerson(id, patch) {
    const r = await api(`/api/person/${id}`, "PUT", { password, patch });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  async deletePerson(id) {
    const r = await api(`/api/person/${id}`, "DELETE", { password });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  async addRelationship(a, b, type, status = "confirmed") {
    const r = await api("/api/relationship", "POST", { password, a, b, type, status });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  async removeRelationBetween(a, b, kind) {
    const r = await api("/api/relationship", "DELETE", { password, a, b, kind });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
    return r.removed;
  },
  async resetOverlay() {
    const r = await api("/api/reset", "POST", { password });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },

  // ------------------------------------------------------ точки расследования
  async setInvestigationStatus(personId, gapType, status) {
    const r = await api(`/api/investigation/${personId}/${gapType}`, "PUT", { password, status });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  investigationStatus(personId, gapType) {
    const rec = overlay?.investigationStatuses?.[`${personId}:${gapType}`];
    return rec ? rec.status : "unknown";
  },

  // ------------------------------------------------------------------ заметки
  async addNote(targetType, targetId, noteType, text) {
    const r = await api("/api/note", "POST", { password, targetType, targetId, noteType, text });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
    return r.note;
  },
  async deleteNote(id) {
    const r = await api(`/api/note/${id}`, "DELETE", { password });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  notesFor(targetType, targetId) {
    return (overlay?.notes || []).filter((n) => n.targetType === targetType && n.targetId === targetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  // ---------------------------------------------------------------- кандидаты
  async addCandidate(data) {
    const r = await api("/api/candidate", "POST", { password, ...data });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
    return r.candidate;
  },
  async updateCandidate(id, patch) {
    const r = await api(`/api/candidate/${id}`, "PUT", { password, patch });
    overlay = r.overlay;
    listeners.forEach((fn) => fn());
  },
  candidates() { return overlay?.candidates || []; },

  // --------------------------------------------------------------------- AI
  isAiConfigured() { return !!aiConfigured; },
  async aiSearchStrategies(personId) { return api("/api/ai/search-strategies", "POST", { password, personId }); },
  async aiCompareCandidate(personId, candidate, candidateId) { return api("/api/ai/compare-candidate", "POST", { password, personId, candidate, candidateId }); },
  async aiDossier(personId, style) { return api("/api/ai/dossier", "POST", { password, personId, style }); },
  async aiSurname(surname, familyContext) { return api("/api/ai/surname", "POST", { password, surname, familyContext }); },
  async aiHistoricalContext(personId, yearFrom, yearTo) { return api("/api/ai/historical-context", "POST", { password, personId, yearFrom, yearTo }); },
  async aiAnalyzeBranch(branchLabel, personIds) { return api("/api/ai/analyze-branch", "POST", { password, branchLabel, personIds }); },

  parentsOf(id) {
    return this.get().relationships.filter((r) => r.type === "parent" && r.b === id).map((r) => this.getPerson(r.a)).filter(Boolean);
  },
  childrenOf(id) {
    return this.get().relationships.filter((r) => r.type === "parent" && r.a === id).map((r) => this.getPerson(r.b)).filter(Boolean);
  },
  spousesOf(id) {
    return this.get().relationships.filter((r) => r.type === "spouse" && (r.a === id || r.b === id)).map((r) => this.getPerson(r.a === id ? r.b : r.a)).filter(Boolean);
  },
  siblingsOf(id) {
    const rels = this.get().relationships;
    const direct = rels.filter((r) => r.type === "sibling" && (r.a === id || r.b === id)).map((r) => (r.a === id ? r.b : r.a));
    const parentIds = this.parentsOf(id).map((p) => p.id);
    const viaParents = rels.filter((r) => r.type === "parent" && parentIds.includes(r.a) && r.b !== id).map((r) => r.b);
    return Array.from(new Set([...direct, ...viaParents])).map((x) => this.getPerson(x)).filter(Boolean);
  },

  exportJSON() { return JSON.stringify({ seed, overlay }, null, 2); },

  stats() {
    const s = this.get();
    return {
      persons: s.persons.length,
      generations: new Set(s.persons.map((p) => p._meta?.generation).filter((g) => g !== null && g !== undefined)).size,
      photos: s.persons.filter((p) => p.photo).length,
    };
  },
};
