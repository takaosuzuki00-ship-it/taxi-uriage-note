import { calcTotal, normalizeEntryNumbers, todayString } from "./calc.js";

export const DB_NAME = "taxi-sales-note";
export const DB_VERSION = 1;
export const SETTINGS_KEY = "app";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMERIC_FIELDS = [
  "trips",
  "km",
  "cash",
  "card",
  "ic",
  "qr",
  "ticket",
  "breakMin",
  "fuel",
  "expenseOther",
];

let dbPromise;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) {
        const entries = db.createObjectStore("entries", { keyPath: "id" });
        entries.createIndex("date", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function txStore(db, storeName, mode = "readonly") {
  const tx = db.transaction(storeName, mode);
  return { tx, store: tx.objectStore(storeName) };
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    const v = c === "x" ? r : (r & 3) | 8;
    return v.toString(16);
  });
}

function minutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

export function validateEntry(entry) {
  const errors = [];
  if (!DATE_RE.test(entry.date || "")) errors.push("日付をYYYY-MM-DD形式で入力してください。");
  NUMERIC_FIELDS.forEach((field) => {
    const value = Number(entry[field] ?? 0);
    if (!Number.isFinite(value) || value < 0) errors.push(`${field} は0以上の数値で入力してください。`);
  });
  ["workStart", "workEnd"].forEach((field) => {
    if (entry[field] !== null && entry[field] !== "" && entry[field] !== undefined && !TIME_RE.test(entry[field])) {
      errors.push(`${field} はHH:MM形式で入力してください。`);
    }
  });
  if (entry.workStart && entry.workEnd && TIME_RE.test(entry.workStart) && TIME_RE.test(entry.workEnd)) {
    const start = minutes(entry.workStart);
    const end = minutes(entry.workEnd);
    const duration = end >= start ? end - start : end + 1440 - start;
    if (duration <= 0 || duration > 1440) errors.push("出庫・帰庫時刻を確認してください。");
  }
  if (errors.length) throw new Error(errors[0]);
}

export function normalizeEntry(input = {}, existing = null) {
  const now = new Date().toISOString();
  const entry = normalizeEntryNumbers({
    id: input.id || existing?.id || uuid(),
    date: input.date || existing?.date || todayString(),
    trips: input.trips ?? existing?.trips ?? 0,
    km: input.km ?? existing?.km ?? 0,
    cash: input.cash ?? existing?.cash ?? 0,
    card: input.card ?? existing?.card ?? 0,
    ic: input.ic ?? existing?.ic ?? 0,
    qr: input.qr ?? existing?.qr ?? 0,
    ticket: input.ticket ?? existing?.ticket ?? 0,
    workStart: input.workStart || null,
    workEnd: input.workEnd || null,
    breakMin: input.breakMin ?? existing?.breakMin ?? 0,
    fuel: input.fuel ?? existing?.fuel ?? 0,
    expenseOther: input.expenseOther ?? existing?.expenseOther ?? 0,
    memo: String(input.memo ?? existing?.memo ?? "").trim(),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  });
  entry.total = calcTotal(entry);
  validateEntry(entry);
  return entry;
}

export async function getAllEntries() {
  const db = await openDb();
  const { store } = txStore(db, "entries");
  const entries = await requestToPromise(store.getAll());
  return entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getEntry(id) {
  const db = await openDb();
  const { store } = txStore(db, "entries");
  return requestToPromise(store.get(id));
}

export async function saveEntry(input) {
  const db = await openDb();
  const existing = input.id ? await getEntry(input.id) : null;
  const entry = normalizeEntry(input, existing);
  const { tx, store } = txStore(db, "entries", "readwrite");
  store.put(entry);
  await transactionDone(tx);
  return entry;
}

export async function deleteEntry(id) {
  const db = await openDb();
  const { tx, store } = txStore(db, "entries", "readwrite");
  store.delete(id);
  await transactionDone(tx);
}

export async function clearEntries() {
  const db = await openDb();
  const { tx, store } = txStore(db, "entries", "readwrite");
  store.clear();
  await transactionDone(tx);
}

export async function getSettings() {
  const db = await openDb();
  const { store } = txStore(db, "settings");
  return requestToPromise(store.get(SETTINGS_KEY));
}

export function normalizeSettings(input = {}, existing = null) {
  const now = new Date().toISOString();
  const authMode = input.authMode || existing?.authMode || "none";
  const settings = {
    key: SETTINGS_KEY,
    driverName: String(input.driverName ?? existing?.driverName ?? "").trim(),
    authMode,
    userId: authMode === "idpw" ? String(input.userId ?? existing?.userId ?? "").trim() : null,
    passwordHash: authMode === "idpw" ? input.passwordHash ?? existing?.passwordHash ?? null : null,
    salt: authMode === "idpw" ? input.salt ?? existing?.salt ?? null : null,
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  if (!settings.driverName) throw new Error("乗務員名を入力してください。");
  if (settings.authMode === "idpw" && (!settings.userId || !settings.passwordHash || !settings.salt)) {
    throw new Error("IDとパスワードを設定してください。");
  }
  return settings;
}

export async function saveSettings(input) {
  const db = await openDb();
  const existing = await getSettings();
  const settings = normalizeSettings(input, existing);
  const { tx, store } = txStore(db, "settings", "readwrite");
  store.put(settings);
  await transactionDone(tx);
  return settings;
}

export async function replaceAll({ entries = [], settings = null }) {
  const db = await openDb();
  const tx = db.transaction(["entries", "settings"], "readwrite");
  const entriesStore = tx.objectStore("entries");
  const settingsStore = tx.objectStore("settings");
  entriesStore.clear();
  entries.forEach((entry) => entriesStore.put(normalizeEntry(entry, entry)));
  if (settings) settingsStore.put(normalizeSettings(settings, settings));
  await transactionDone(tx);
}

export async function mergeBackup({ entries = [], settings = null }) {
  const current = await getAllEntries();
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  entries.forEach((entry) => {
    const existing = byId.get(entry.id);
    if (!existing || String(entry.updatedAt || "") > String(existing.updatedAt || "")) {
      byId.set(entry.id, normalizeEntry(entry, entry));
    }
  });
  const db = await openDb();
  const tx = db.transaction(["entries", "settings"], "readwrite");
  const entriesStore = tx.objectStore("entries");
  Array.from(byId.values()).forEach((entry) => entriesStore.put(entry));
  if (settings) tx.objectStore("settings").put(normalizeSettings(settings, settings));
  await transactionDone(tx);
}

export async function exportAllData(includePassword = false) {
  const [entries, settings] = await Promise.all([getAllEntries(), getSettings()]);
  const safeSettings = settings ? { ...settings } : null;
  if (safeSettings && !includePassword) {
    safeSettings.passwordHash = null;
    safeSettings.salt = null;
    if (safeSettings.authMode === "idpw") safeSettings.authMode = "none";
  }
  return {
    app: "タクシー売上ノート",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    settings: safeSettings,
  };
}

export async function deleteDatabase() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
