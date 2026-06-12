const TESSERACT_VERSION = "5.1.1";
const OCR_CACHE = "taxi-sales-note-ocr-v1";
const TESSERACT_SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const TESSERACT_WORKER = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const TESSERACT_CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js";
const TESSERACT_LANG = "https://tessdata.projectnaptha.com/4.0.0";

let tesseractPromise;

export function parseOcrNumbers(text = "") {
  const matches = String(text).match(/\d[\d,\s]{0,14}\d|\d/g) || [];
  return matches
    .map((value) => Number(value.replace(/[,\s]/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function guessSalesFields(numbers = []) {
  const result = {};
  const values = numbers.filter((value) => value > 0);
  const likelyTrips = values.find((value) => value > 0 && value <= 99);
  if (likelyTrips !== undefined) result.trips = likelyTrips;
  const money = values.filter((value) => value >= 100);
  ["cash", "card", "ic", "qr", "ticket"].forEach((field, index) => {
    if (money[index] !== undefined) result[field] = money[index];
  });
  return result;
}

async function primeOcrCache() {
  if (!("caches" in globalThis)) return;
  try {
    const cache = await caches.open(OCR_CACHE);
    await Promise.allSettled([TESSERACT_SCRIPT, TESSERACT_WORKER, TESSERACT_CORE].map((url) => cache.add(url)));
  } catch {
    // OCR still works online when explicit Cache Storage priming fails.
  }
}

async function loadTesseract() {
  if (globalThis.Tesseract) return globalThis.Tesseract;
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_SCRIPT;
      script.async = true;
      script.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error("OCR部品を読み込めませんでした。")));
      script.onerror = () => reject(new Error("OCR部品を読み込めませんでした。"));
      document.head.append(script);
    });
  }
  await primeOcrCache();
  return tesseractPromise;
}

export async function recognizeNumbers(dataUrl, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: TESSERACT_WORKER,
    corePath: TESSERACT_CORE,
    langPath: TESSERACT_LANG,
    cacheMethod: "write",
    logger: (message) => {
      if (message.status) onProgress(message);
    },
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789, ",
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(dataUrl);
    const text = result?.data?.text || "";
    const numbers = parseOcrNumbers(text);
    return { text, numbers, fields: guessSalesFields(numbers) };
  } finally {
    await worker.terminate();
  }
}
