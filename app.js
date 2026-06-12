import { createSalt, hashPassword, verifyPassword } from "./lib/auth.js";
import {
  clearEntries,
  deleteDatabase,
  deleteEntry,
  exportAllData,
  getAllEntries,
  getEntry,
  getSettings,
  mergeBackup,
  replaceAll,
  saveEntry,
  saveSettings,
} from "./lib/db.js";
import { calcTotal, filterByMonth, filterByRange, formatNumber, formatYen, monthKey, summarizeEntries, todayString } from "./lib/calc.js";
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
  activeScreen: "setup",
  visibleMonth: monthKey(new Date()),
  restorePayload: null,
};

const screens = {
  setup: $("#setupScreen"),
  lock: $("#lockScreen"),
  home: $("#homeScreen"),
  entry: $("#entryScreen"),
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
}

async function refreshEntries() {
  state.entries = await getAllEntries();
  renderHome();
  renderHistory();
  renderExportCount();
}

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
  renderEntryList($("#homeEntries"), entries);
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

function toggleAuthFields(scope) {
  const form = scope === "setup" ? $("#setupForm") : $("#settingsForm");
  const fields = scope === "setup" ? $("#setupAuthFields") : $("#settingsAuthFields");
  const mode = new FormData(form).get("authMode");
  fields.classList.toggle("hidden", mode !== "idpw");
}

async function buildSettingsFromForm(form, allowExistingPassword = false) {
  const authMode = new FormData(form).get("authMode");
  const driverName = form.driverName.value;
  if (authMode === "none") return { driverName, authMode };
  const userId = form.userId.value;
  const password = form.password.value;
  if (!password && allowExistingPassword && state.settings?.passwordHash) {
    return {
      driverName,
      authMode,
      userId,
      passwordHash: state.settings.passwordHash,
      salt: state.settings.salt,
    };
  }
  const auth = await hashPassword(password, createSalt());
  return { driverName, authMode, userId, ...auth };
}

function fillSettingsForm() {
  const form = $("#settingsForm");
  if (!state.settings) return;
  form.driverName.value = state.settings.driverName || "";
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
    toast("設定を保存しました。");
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
