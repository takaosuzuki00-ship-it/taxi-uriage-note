import { createSalt, hashPassword, verifyPassword } from "./lib/auth.js";
import {
  clearEntries,
  deleteDatabase,
  deleteEntry,
  deleteShift,
  exportAllData,
  getAllEntries,
  getEntry,
  getSettings,
  getShift,
  getAllShifts,
  mergeBackup,
  replaceAll,
  saveEntry,
  saveSettings,
  saveShift,
} from "./lib/db.js";
import {
  calcTotal,
  estimatePayroll,
  filterByMonth,
  filterByRange,
  formatNumber,
  formatYen,
  monthKey,
  summarizeEntries,
  todayString,
} from "./lib/calc.js";
import {
  downloadBlob,
  filenameFor,
  makeBackupBlob,
  makeCsvBlob,
  makeXlsxBlob,
  parseBackupJson,
} from "./lib/exporter.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  settings: null,
  unlocked: false,
  entries: [],
  shifts: [],
  activeScreen: "setup",
  visibleMonth: monthKey(new Date()),
  restorePayload: null,
};

const screens = {
  setup: $("#setupScreen"),
  lock: $("#lockScreen"),
  home: $("#homeScreen"),
  entry: $("#entryScreen"),
  shifts: $("#shiftsScreen"),
  payroll: $("#payrollScreen"),
  profile: $("#profileScreen"),
  history: $("#historyScreen"),
  export: $("#exportScreen"),
  settings: $("#settingsScreen"),
};

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function showScreen(name) {
  state.activeScreen = name;
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("active", key === name));
  const title = screens[name]?.dataset.title || "ホーム";
  $("#screenTitle").textContent = title;
  const locked = name === "setup" || name === "lock";
  $("#bottomNav").classList.toggle("hidden", locked);
  $$("#bottomNav button").forEach((button) => button.classList.toggle("active", button.dataset.nav === name));
  if (name === "history") renderHistory();
  if (name === "export") renderExportCount();
  if (name === "settings") fillSettingsForm();
  if (name === "shifts") renderShifts();
  if (name === "payroll") renderPayroll();
  if (name === "profile") renderProfile();
}

async function refreshData() {
  [state.entries, state.shifts] = await Promise.all([getAllEntries(), getAllShifts()]);
  renderHome();
  renderHistory();
  renderExportCount();
  renderShifts();
  renderPayroll();
  renderProfile();
}

const refreshEntries = refreshData;

function currentMonthEntries() {
  return filterByMonth(state.entries, state.visibleMonth);
}

function renderHome() {
  $("#homeMonth").value = state.visibleMonth;
  $("#historyMonth").value = state.visibleMonth;
  const entries = currentMonthEntries();
  const summary = summarizeEntries(entries);
  $("#homeTotal").textContent = formatYen(summary.total);
  $("#homeTrips").textContent = `${formatNumber(summary.trips)}回`;
  $("#homeNet").textContent = formatYen(summary.net);
  $("#homeCount").textContent = `${entries.length}件`;
  renderTodayShift();
  renderEntryList($("#homeEntries"), entries);
}

function shiftTimeLabel(shift) {
  if (!shift?.planStart && !shift?.planEnd) return "時間未設定";
  return `${shift.planStart || "--:--"}-${shift.planEnd || "--:--"}`;
}

function renderTodayShift() {
  const today = todayString();
  const shift = state.shifts.find((item) => item.date === today);
  if (!shift) {
    $("#todayShiftTitle").textContent = "本日の出番予定はありません";
    $("#todayShiftMeta").textContent = "出番・シフトから予定を登録できます。";
    return;
  }
  $("#todayShiftTitle").textContent = `${shift.kind} ${shift.kind === "出番" ? shiftTimeLabel(shift) : ""}`.trim();
  $("#todayShiftMeta").textContent = shift.memo || `${shift.date} の予定`;
}

function renderHistory() {
  const entries = currentMonthEntries();
  const summary = summarizeEntries(entries);
  $("#historySummary").innerHTML = `
    <div><span>売上合計</span><strong>${formatYen(summary.total)}</strong></div>
    <div><span>営業回数</span><strong>${formatNumber(summary.trips)}回</strong></div>
    <div><span>手取り</span><strong>${formatYen(summary.net)}</strong></div>
  `;
  renderEntryList($("#historyEntries"), entries);
}

function renderEntryList(container, entries) {
  container.innerHTML = "";
  if (!entries.length) {
    container.innerHTML = '<p class="empty">この月の記録はまだありません。</p>';
    return;
  }
  entries.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-item";
    button.dataset.id = entry.id;
    button.innerHTML = `
      <span>
        <small>${entry.date} ${entry.workStart || ""}${entry.workEnd ? `-${entry.workEnd}` : ""}</small>
        <strong>${formatYen(entry.total)}</strong>
        <small>${formatNumber(entry.trips)}回 / ${formatNumber(entry.km, 1)}km</small>
      </span>
      <span>${formatYen(entry.total - entry.fuel - entry.expenseOther)}</span>
    `;
    button.addEventListener("click", () => openEntry(entry.id));
    container.append(button);
  });
}

function fillEntryForm(entry = null) {
  const form = $("#entryForm");
  form.reset();
  form.elements.id.value = entry?.id || "";
  form.date.value = entry?.date || todayString();
  ["trips", "km", "cash", "card", "ic", "qr", "ticket", "breakMin", "fuel", "expenseOther"].forEach((field) => {
    form[field].value = entry?.[field] ?? "";
  });
  form.workStart.value = entry?.workStart || "";
  form.workEnd.value = entry?.workEnd || "";
  form.memo.value = entry?.memo || "";
  $("#deleteEntryBtn").classList.toggle("hidden", !entry?.id);
  updateLiveTotal();
}

async function openEntry(id = null) {
  const entry = id ? await getEntry(id) : null;
  fillEntryForm(entry);
  showScreen("entry");
}

function formEntryPayload() {
  const form = $("#entryForm");
  return {
    id: form.elements.id.value || undefined,
    date: form.date.value,
    trips: form.trips.value,
    km: form.km.value,
    cash: form.cash.value,
    card: form.card.value,
    ic: form.ic.value,
    qr: form.qr.value,
    ticket: form.ticket.value,
    workStart: form.workStart.value || null,
    workEnd: form.workEnd.value || null,
    breakMin: form.breakMin.value,
    fuel: form.fuel.value,
    expenseOther: form.expenseOther.value,
    memo: form.memo.value,
  };
}

function updateLiveTotal() {
  $("#liveTotal").textContent = formatYen(calcTotal(formEntryPayload()));
}

function fillShiftForm(shift = null) {
  const form = $("#shiftForm");
  form.reset();
  form.elements.id.value = shift?.id || "";
  form.date.value = shift?.date || todayString();
  form.kind.value = shift?.kind || "出番";
  form.planStart.value = shift?.planStart || "";
  form.planEnd.value = shift?.planEnd || "";
  form.memo.value = shift?.memo || "";
  $("#deleteShiftBtn").classList.toggle("hidden", !shift?.id);
}

async function openShift(id = null) {
  const shift = id ? await getShift(id) : null;
  fillShiftForm(shift);
  showScreen("shifts");
}

function formShiftPayload() {
  const form = $("#shiftForm");
  return {
    id: form.elements.id.value || undefined,
    date: form.date.value,
    kind: form.kind.value,
    planStart: form.planStart.value || null,
    planEnd: form.planEnd.value || null,
    memo: form.memo.value,
  };
}

function renderShifts() {
  const monthInput = $("#shiftMonth");
  if (!monthInput) return;
  monthInput.value = state.visibleMonth;
  const shifts = filterByMonth(state.shifts, state.visibleMonth);
  const container = $("#shiftList");
  container.innerHTML = "";
  if (!shifts.length) {
    container.innerHTML = '<p class="empty">この月の出番予定はまだありません。</p>';
    return;
  }
  shifts.forEach((shift) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shift-item kind-${shift.kind}`;
    button.dataset.id = shift.id;
    button.innerHTML = `
      <span class="shift-date">${shift.date}</span>
      <span>
        <strong>${shift.kind}</strong>
        <small>${shiftTimeLabel(shift)}${shift.memo ? ` / ${escapeHtml(shift.memo)}` : ""}</small>
      </span>
    `;
    button.addEventListener("click", () => openShift(shift.id));
    container.append(button);
  });
}

function renderPayroll() {
  const monthInput = $("#payrollMonth");
  if (!monthInput) return;
  monthInput.value = state.visibleMonth;
  const summary = summarizeEntries(currentMonthEntries());
  const payRate = state.settings?.payRate || 0;
  const baseSalary = state.settings?.baseSalary || 0;
  const variablePay = estimatePayroll(summary.total, { payRate, baseSalary: 0 });
  const total = estimatePayroll(summary.total, { payRate, baseSalary });
  $("#payrollPanel").innerHTML = `
    <div><span>対象月</span><strong>${state.visibleMonth}</strong></div>
    <div><span>売上合計</span><strong>${formatYen(summary.total)}</strong></div>
    <div><span>歩合 ${formatNumber(payRate, 1)}%</span><strong>${formatYen(variablePay)}</strong></div>
    <div><span>基本給</span><strong>${formatYen(baseSalary)}</strong></div>
    <div class="payroll-total"><span>概算合計</span><strong>${formatYen(total)}</strong></div>
  `;
}

function profileFieldsFromSettings() {
  return {
    driverName: state.settings?.driverName || "",
    employeeNo: state.settings?.employeeNo || "",
    office: state.settings?.office || "",
    carNo: state.settings?.carNo || "",
    licenseNo: state.settings?.licenseNo || "",
  };
}

function renderProfile() {
  if (!state.settings) return;
  const fields = profileFieldsFromSettings();
  $("#profileView").innerHTML = `
    <div class="profile-name">${escapeHtml(fields.driverName || "未設定")}</div>
    <dl>
      <div><dt>社員番号</dt><dd>${escapeHtml(fields.employeeNo || "-")}</dd></div>
      <div><dt>所属営業所</dt><dd>${escapeHtml(fields.office || "-")}</dd></div>
      <div><dt>車番</dt><dd>${escapeHtml(fields.carNo || "-")}</dd></div>
      <div><dt>免許番号</dt><dd>${escapeHtml(fields.licenseNo || "-")}</dd></div>
    </dl>
  `;
  const form = $("#profileForm");
  Object.entries(fields).forEach(([key, value]) => {
    form[key].value = value;
  });
}

function toggleAuthFields(scope) {
  const form = scope === "setup" ? $("#setupForm") : $("#settingsForm");
  const fields = scope === "setup" ? $("#setupAuthFields") : $("#settingsAuthFields");
  const mode = new FormData(form).get("authMode");
  fields.classList.toggle("hidden", mode !== "idpw");
}

async function buildSettingsFromForm(form, allowExistingPassword = false) {
  const authMode = new FormData(form).get("authMode");
  const base = {
    driverName: form.driverName.value,
    employeeNo: form.employeeNo?.value ?? state.settings?.employeeNo ?? "",
    office: form.office?.value ?? state.settings?.office ?? "",
    carNo: form.carNo?.value ?? state.settings?.carNo ?? "",
    licenseNo: form.licenseNo?.value ?? state.settings?.licenseNo ?? "",
    payRate: form.payRate?.value ?? state.settings?.payRate ?? 0,
    baseSalary: form.baseSalary?.value ?? state.settings?.baseSalary ?? 0,
  };
  if (authMode === "none") return { ...base, authMode };
  const userId = form.userId.value;
  const password = form.password.value;
  if (!password && allowExistingPassword && state.settings?.passwordHash) {
    return {
      ...base,
      authMode,
      userId,
      passwordHash: state.settings.passwordHash,
      salt: state.settings.salt,
    };
  }
  const auth = await hashPassword(password, createSalt());
  return { ...base, authMode, userId, ...auth };
}

function fillSettingsForm() {
  const form = $("#settingsForm");
  if (!state.settings) return;
  form.driverName.value = state.settings.driverName || "";
  form.payRate.value = state.settings.payRate ?? 0;
  form.baseSalary.value = state.settings.baseSalary ?? 0;
  form.employeeNo.value = state.settings.employeeNo || "";
  form.office.value = state.settings.office || "";
  form.carNo.value = state.settings.carNo || "";
  form.licenseNo.value = state.settings.licenseNo || "";
  form.userId.value = state.settings.userId || "";
  form.password.value = "";
  $$('input[name="authMode"]', form).forEach((input) => {
    input.checked = input.value === state.settings.authMode;
  });
  toggleAuthFields("settings");
}

function driverLabel() {
  $("#driverChip").textContent = state.settings?.driverName || "未設定";
}

function selectedExportEntries() {
  const mode = $('input[name="rangeMode"]:checked')?.value || "month";
  if (mode === "all") return { entries: [...state.entries], label: "all" };
  if (mode === "custom") {
    const startDate = $("#exportStart").value;
    const endDate = $("#exportEnd").value;
    return {
      entries: filterByRange(state.entries, startDate, endDate),
      label: `${startDate || "start"}_${endDate || "end"}`,
    };
  }
  const entries = filterByMonth(state.entries, state.visibleMonth);
  return { entries, label: state.visibleMonth };
}

function renderExportCount() {
  const { entries } = selectedExportEntries();
  $("#exportCount").textContent = `${entries.length}件を出力対象にしています。`;
}

async function writeBackup(includePassword) {
  const data = await exportAllData(includePassword);
  const filename = `taxi-uriage_backup_${todayString().replaceAll("-", "")}.json`;
  downloadBlob(makeBackupBlob(data), filename);
}

async function restoreFromSelectedFile(mode) {
  if (!state.restorePayload) {
    toast("先にJSONファイルを選択してください。");
    return;
  }
  if (mode === "replace") {
    if (!confirm("既存データを置き換えて復元します。よろしいですか？")) return;
    await replaceAll(state.restorePayload);
  } else {
    await mergeBackup(state.restorePayload);
  }
  state.settings = await getSettings();
  state.unlocked = state.settings?.authMode !== "idpw";
  driverLabel();
  await refreshEntries();
  toast("復元しました。");
  showScreen("home");
}

function changeMonth(delta) {
  const [year, month] = state.visibleMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  state.visibleMonth = monthKey(date);
  renderHome();
  renderHistory();
  renderExportCount();
  renderShifts();
  renderPayroll();
}

async function init() {
  state.settings = await getSettings();
  driverLabel();
  if (!state.settings) {
    showScreen("setup");
  } else if (state.settings.authMode === "idpw") {
    showScreen("lock");
  } else {
    state.unlocked = true;
    await refreshEntries();
    showScreen("home");
  }
}

$("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const settings = await buildSettingsFromForm(event.currentTarget);
    state.settings = await saveSettings(settings);
    state.unlocked = true;
    driverLabel();
    await refreshEntries();
    toast("セットアップしました。");
    showScreen("home");
  } catch (error) {
    toast(error.message);
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const idOk = form.userId.value === state.settings.userId;
  const passOk = await verifyPassword(form.password.value, state.settings.salt, state.settings.passwordHash);
  if (!idOk || !passOk) {
    toast("IDまたはパスワードが違います。");
    return;
  }
  state.unlocked = true;
  await refreshEntries();
  showScreen("home");
});

$("#entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const entry = await saveEntry(formEntryPayload());
    state.visibleMonth = monthKey(entry.date);
    await refreshEntries();
    toast("保存しました。");
    showScreen("home");
  } catch (error) {
    toast(error.message);
  }
});

$("#deleteEntryBtn").addEventListener("click", async () => {
  const id = $("#entryForm").elements.id.value;
  if (!id || !confirm("この売上記録を削除しますか？")) return;
  await deleteEntry(id);
  await refreshEntries();
  toast("削除しました。");
  showScreen("home");
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.settings = await saveSettings(await buildSettingsFromForm(event.currentTarget, true));
    driverLabel();
    renderPayroll();
    renderProfile();
    toast("設定を保存しました。");
  } catch (error) {
    toast(error.message);
  }
});

$("#shiftForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const shift = await saveShift(formShiftPayload());
    state.visibleMonth = monthKey(shift.date);
    await refreshData();
    fillShiftForm();
    toast("出番予定を保存しました。");
  } catch (error) {
    toast(error.message);
  }
});

$("#deleteShiftBtn").addEventListener("click", async () => {
  const id = $("#shiftForm").elements.id.value;
  if (!id || !confirm("この出番予定を削除しますか？")) return;
  await deleteShift(id);
  await refreshData();
  fillShiftForm();
  toast("出番予定を削除しました。");
});

$("#resetShiftBtn").addEventListener("click", () => fillShiftForm());

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    state.settings = await saveSettings({
      ...state.settings,
      driverName: form.driverName.value,
      employeeNo: form.employeeNo.value,
      office: form.office.value,
      carNo: form.carNo.value,
      licenseNo: form.licenseNo.value,
    });
    driverLabel();
    renderProfile();
    toast("プロフィールを保存しました。");
  } catch (error) {
    toast(error.message);
  }
});

$("#homeMonth").addEventListener("change", (event) => {
  state.visibleMonth = event.target.value || monthKey(new Date());
  renderHome();
  renderHistory();
});
$("#historyMonth").addEventListener("change", (event) => {
  state.visibleMonth = event.target.value || monthKey(new Date());
  renderHome();
  renderHistory();
});
$("#prevMonthBtn").addEventListener("click", () => changeMonth(-1));
$("#nextMonthBtn").addEventListener("click", () => changeMonth(1));
$("#shiftMonth").addEventListener("change", (event) => {
  state.visibleMonth = event.target.value || monthKey(new Date());
  renderHome();
  renderShifts();
});
$("#payrollMonth").addEventListener("change", (event) => {
  state.visibleMonth = event.target.value || monthKey(new Date());
  renderHome();
  renderPayroll();
});
$("#prevShiftMonthBtn").addEventListener("click", () => changeMonth(-1));
$("#nextShiftMonthBtn").addEventListener("click", () => changeMonth(1));
$("#newEntryBtn").addEventListener("click", () => openEntry());
$("#entryForm").addEventListener("input", updateLiveTotal);

$$("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.nav === "entry") openEntry();
    else showScreen(button.dataset.nav);
  });
});

$$('input[name="authMode"]', $("#setupForm")).forEach((input) => input.addEventListener("change", () => toggleAuthFields("setup")));
$$('input[name="authMode"]', $("#settingsForm")).forEach((input) => input.addEventListener("change", () => toggleAuthFields("settings")));
$$('input[name="rangeMode"]').forEach((input) => input.addEventListener("change", renderExportCount));
$("#exportStart").addEventListener("change", renderExportCount);
$("#exportEnd").addEventListener("change", renderExportCount);

$("#xlsxBtn").addEventListener("click", () => {
  const { entries, label } = selectedExportEntries();
  downloadBlob(makeXlsxBlob(entries), filenameFor("xlsx", entries, label));
});
$("#csvBtn").addEventListener("click", () => {
  const { entries, label } = selectedExportEntries();
  downloadBlob(makeCsvBlob(entries), filenameFor("csv", entries, label));
});
$("#backupBtn").addEventListener("click", () => writeBackup(false));
$("#backupSettingsBtn").addEventListener("click", () => writeBackup($("#includePassword").checked));

$("#restoreFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.restorePayload = parseBackupJson(await file.text());
    toast(`${file.name} を読み込みました。`);
  } catch (error) {
    state.restorePayload = null;
    toast(error.message);
  }
});
$("#mergeRestoreBtn").addEventListener("click", () => restoreFromSelectedFile("merge"));
$("#replaceRestoreBtn").addEventListener("click", () => restoreFromSelectedFile("replace"));

$("#wipeBtn").addEventListener("click", async () => {
  if (!confirm("全データを削除します。本当によろしいですか？")) return;
  await clearEntries();
  await deleteDatabase();
  state.settings = null;
  state.entries = [];
  state.unlocked = false;
  driverLabel();
  toast("全データを削除しました。");
  showScreen("setup");
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

toggleAuthFields("setup");
init().catch((error) => toast(error.message));
