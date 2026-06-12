import { calcNet, calcTotal, compactDate, filterByRange, monthKey, summarizeEntries } from "./calc.js";

export const EXPORT_HEADERS = [
  "日付",
  "営業回数",
  "走行km",
  "現金",
  "カード",
  "IC",
  "QR",
  "チケット",
  "売上合計",
  "出庫",
  "帰庫",
  "休憩(分)",
  "燃料費",
  "その他経費",
  "手取り概算",
  "メモ",
];

const NUMERIC_KEYS = new Set([
  "trips",
  "km",
  "cash",
  "card",
  "ic",
  "qr",
  "ticket",
  "total",
  "breakMin",
  "fuel",
  "expenseOther",
  "net",
]);

export function entryToRow(entry) {
  const total = Number(entry.total ?? calcTotal(entry));
  return {
    date: entry.date,
    trips: Number(entry.trips || 0),
    km: Number(entry.km || 0),
    cash: Number(entry.cash || 0),
    card: Number(entry.card || 0),
    ic: Number(entry.ic || 0),
    qr: Number(entry.qr || 0),
    ticket: Number(entry.ticket || 0),
    total,
    workStart: entry.workStart || "",
    workEnd: entry.workEnd || "",
    breakMin: Number(entry.breakMin || 0),
    fuel: Number(entry.fuel || 0),
    expenseOther: Number(entry.expenseOther || 0),
    net: calcNet(entry),
    memo: entry.memo || "",
  };
}

export function rowsForExport(entries = []) {
  const sorted = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = sorted.map(entryToRow);
  const summary = summarizeEntries(sorted);
  rows.push({
    date: "期間合計",
    trips: summary.trips,
    km: summary.km,
    cash: summary.cash,
    card: summary.card,
    ic: summary.ic,
    qr: summary.qr,
    ticket: summary.ticket,
    total: summary.total,
    workStart: "",
    workEnd: "",
    breakMin: summary.breakMin,
    fuel: summary.fuel,
    expenseOther: summary.expenseOther,
    net: summary.net,
    memo: "",
  });
  return rows;
}

export function rowToArray(row) {
  return [
    row.date,
    row.trips,
    row.km,
    row.cash,
    row.card,
    row.ic,
    row.qr,
    row.ticket,
    row.total,
    row.workStart,
    row.workEnd,
    row.breakMin,
    row.fuel,
    row.expenseOther,
    row.net,
    row.memo,
  ];
}

export function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value).replace(/\r\n|\r|\n/g, "\r\n");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function makeCsv(entries = []) {
  const lines = [EXPORT_HEADERS, ...rowsForExport(entries).map(rowToArray)]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  return `\uFEFF${lines}\r\n`;
}

export function makeWorkbookArray(entries = []) {
  return [EXPORT_HEADERS, ...rowsForExport(entries).map(rowToArray)];
}

export function makeXlsxBlob(entries = []) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("SheetJSが読み込まれていません。");
  const worksheet = XLSX.utils.aoa_to_sheet(makeWorkbookArray(entries));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "売上");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function makeCsvBlob(entries = []) {
  return new Blob([makeCsv(entries)], { type: "text/csv;charset=utf-8" });
}

export function makeBackupBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function filenameFor(extension, entries = [], rangeLabel = "") {
  const generated = compactDate(new Date().toISOString().slice(0, 10));
  let period = rangeLabel;
  if (!period && entries.length) {
    const months = Array.from(new Set(entries.map((entry) => monthKey(entry.date))));
    period = months.length === 1 ? months[0] : `${entries[0].date}_${entries[entries.length - 1].date}`;
  }
  return `taxi-uriage_${period || "all"}_${generated}.${extension}`;
}

export function filterEntriesForExport(entries, { startDate, endDate } = {}) {
  return filterByRange(entries, startDate, endDate);
}

export function parseBackupJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error("バックアップJSONの形式が正しくありません。");
  }
  return {
    entries: parsed.entries,
    shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
    payslips: Array.isArray(parsed.payslips) ? parsed.payslips : [],
    settings: parsed.settings || null,
  };
}

export function numericColumnKeys() {
  return NUMERIC_KEYS;
}
