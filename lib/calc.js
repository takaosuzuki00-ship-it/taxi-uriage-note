export const PAYMENT_FIELDS = ["cash", "card", "ic", "qr", "ticket"];
export const EXPENSE_FIELDS = ["fuel", "expenseOther"];

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function yen(value) {
  return Math.round(toNumber(value));
}

export function calcTotal(entry = {}) {
  return PAYMENT_FIELDS.reduce((sum, field) => sum + yen(entry[field]), 0);
}

export function calcNet(entry = {}) {
  return calcTotal(entry) - yen(entry.fuel) - yen(entry.expenseOther);
}

export function estimatePayroll(monthSalesTotal, { payRate = 0, baseSalary = 0 } = {}) {
  return yen(toNumber(monthSalesTotal) * (toNumber(payRate) / 100) + toNumber(baseSalary));
}

export function payslipNet(gross, deduction) {
  return yen(toNumber(gross) - toNumber(deduction));
}

export function monthKey(date = new Date()) {
  if (typeof date === "string") return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function compactDate(dateText) {
  return String(dateText || "").replaceAll("-", "");
}

export function normalizeEntryNumbers(entry = {}) {
  const normalized = { ...entry };
  ["trips", "km", "breakMin", ...PAYMENT_FIELDS, ...EXPENSE_FIELDS].forEach((field) => {
    normalized[field] = toNumber(normalized[field]);
  });
  normalized.total = calcTotal(normalized);
  return normalized;
}

export function summarizeEntries(entries = []) {
  const base = {
    count: 0,
    trips: 0,
    km: 0,
    cash: 0,
    card: 0,
    ic: 0,
    qr: 0,
    ticket: 0,
    total: 0,
    breakMin: 0,
    fuel: 0,
    expenseOther: 0,
    net: 0,
  };

  return entries.reduce((summary, raw) => {
    const entry = normalizeEntryNumbers(raw);
    summary.count += 1;
    summary.trips += entry.trips;
    summary.km += entry.km;
    PAYMENT_FIELDS.forEach((field) => {
      summary[field] += yen(entry[field]);
    });
    summary.total += calcTotal(entry);
    summary.breakMin += entry.breakMin;
    summary.fuel += yen(entry.fuel);
    summary.expenseOther += yen(entry.expenseOther);
    summary.net += calcNet(entry);
    return summary;
  }, { ...base });
}

export function filterByMonth(entries = [], month) {
  return entries.filter((entry) => String(entry.date || "").startsWith(month));
}

export function filterByRange(entries = [], startDate, endDate) {
  return entries.filter((entry) => {
    const date = entry.date || "";
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  });
}

export function groupByMonth(entries = []) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = monthKey(entry.date);
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  });
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({ month, entries: list, summary: summarizeEntries(list) }));
}

export function formatYen(value) {
  return `${yen(value).toLocaleString("ja-JP")}円`;
}

export function formatNumber(value, digits = 0) {
  return toNumber(value).toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
