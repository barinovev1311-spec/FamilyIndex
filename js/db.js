// db.js — данные семьи Скрябиных.
// Стартовые данные — из вашего файла (window.SEED_DATA, см. seed-data.js).
// Все правки, которые Марина вносит через админку, хранятся поверх — в
// localStorage браузера, и не портят исходный набор. Экспорт JSON в
// разделе «Настройки» — это полная резервная копия обоих слоёв вместе.

import { computeAllRelations } from "./relations.js";

const STORAGE_KEY = "skryabin-family:v1";

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function loadOverlay() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { addedPersons: [], addedRelationships: [], edits: {}, deleted: [] };
  } catch (e) {
    console.error("Не удалось прочитать сохранённые правки, начинаю с чистого листа", e);
    return { addedPersons: [], addedRelationships: [], edits: {}, deleted: [] };
  }
}

let overlay = loadOverlay();
const listeners = new Set();

function saveOverlay() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  listeners.forEach((fn) => fn());
}

function buildState() {
  const seed = window.SEED_DATA;
  const persons = [...seed.persons, ...overlay.addedPersons]
    .filter((p) => !overlay.deleted.includes(p.id))
    .map((p) => (overlay.edits[p.id] ? { ...p, ...overlay.edits[p.id] } : p));
  const relationships = [...seed.relationships, ...overlay.addedRelationships].filter(
    (r) => !overlay.deleted.includes(r.id)
  );
  const relMap = computeAllRelations(persons, relationships, seed.marinaId, seed.husbandId);
  persons.forEach((p) => { p._meta = relMap.get(p.id) || { generation: null, side: null, relationToMarina: "родство не установлено" }; });
  return { persons, relationships, marinaId: seed.marinaId, husbandId: seed.husbandId, researchNotes: seed.researchNotes };
}

export const DB = {
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get() {
    return buildState();
  },
  getPerson(id) {
    return this.get().persons.find((p) => p.id === id) || null;
  },
  addPerson(data) {
    const person = {
      id: uid("p"),
      firstName: "", middleName: "", lastName: "", maidenName: "",
      gender: "unknown", isLiving: true,
      birth: { mode: "unknown" }, death: { mode: "unknown" },
      birthPlace: "", deathPlace: "", occupation: "", bio: "", notes: "",
      photo: "", nameVariants: [], verificationStatus: "unverified",
      createdAt: new Date().toISOString(),
      _meta: { generation: null, side: null, relationToMarina: "родство ещё не рассчитано — сохраните и обновите связи" },
      ...data,
    };
    overlay.addedPersons.push(person);
    saveOverlay();
    return person;
  },
  updatePerson(id, patch) {
    overlay.edits[id] = { ...(overlay.edits[id] || {}), ...patch, updatedAt: new Date().toISOString() };
    saveOverlay();
  },
  deletePerson(id) {
    overlay.deleted.push(id);
    saveOverlay();
  },
  addRelationship(a, b, type, status = "confirmed") {
    const rel = { id: uid("r"), a, b, type, status, createdAt: new Date().toISOString() };
    overlay.addedRelationships.push(rel);
    saveOverlay();
    return rel;
  },
  deleteRelationship(id) {
    overlay.deleted.push(id);
    saveOverlay();
  },
  removeRelationBetween(a, b, kind) {
    // kind: 'parent-of-them' (a is parent of b's target... ), проще: ищем любую relationship
    // между a и b подходящего типа и убираем её (работает для parent в обе стороны, spouse, sibling)
    const rels = this.get().relationships;
    let match;
    if (kind === "spouse" || kind === "sibling") {
      const type = kind;
      match = rels.find((r) => r.type === type && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    } else if (kind === "parent-of-them") {
      // b (собеседник) — родитель a (текущей карточки)
      match = rels.find((r) => r.type === "parent" && r.a === b && r.b === a);
    } else if (kind === "parent-of-me") {
      // a (текущая карточка) — родитель b
      match = rels.find((r) => r.type === "parent" && r.a === a && r.b === b);
    }
    if (match) { overlay.deleted.push(match.id); saveOverlay(); return true; }
    return false;
  },

  parentsOf(id) {
    return this.get().relationships.filter((r) => r.type === "parent" && r.b === id)
      .map((r) => this.getPerson(r.a)).filter(Boolean);
  },
  childrenOf(id) {
    return this.get().relationships.filter((r) => r.type === "parent" && r.a === id)
      .map((r) => this.getPerson(r.b)).filter(Boolean);
  },
  spousesOf(id) {
    return this.get().relationships.filter((r) => r.type === "spouse" && (r.a === id || r.b === id))
      .map((r) => this.getPerson(r.a === id ? r.b : r.a)).filter(Boolean);
  },
  siblingsOf(id) {
    const rels = this.get().relationships;
    const direct = rels.filter((r) => r.type === "sibling" && (r.a === id || r.b === id))
      .map((r) => (r.a === id ? r.b : r.a));
    const parentIds = this.parentsOf(id).map((p) => p.id);
    const viaParents = rels.filter((r) => r.type === "parent" && parentIds.includes(r.a) && r.b !== id).map((r) => r.b);
    return Array.from(new Set([...direct, ...viaParents])).map((x) => this.getPerson(x)).filter(Boolean);
  },

  exportJSON() {
    return JSON.stringify({ seed: window.SEED_DATA, overlay }, null, 2);
  },
  importJSON(json) {
    const parsed = JSON.parse(json);
    if (parsed.overlay) overlay = parsed.overlay;
    saveOverlay();
  },
  resetOverlay() {
    overlay = { addedPersons: [], addedRelationships: [], edits: {}, deleted: [] };
    saveOverlay();
  },

  stats() {
    const s = this.get();
    return {
      persons: s.persons.length,
      generations: new Set(s.persons.map((p) => p._meta?.generation).filter((g) => g !== null && g !== undefined)).size,
      photos: s.persons.filter((p) => p.photo).length,
      documented: s.persons.filter((p) => p.birthPlace).length,
    };
  },
};
