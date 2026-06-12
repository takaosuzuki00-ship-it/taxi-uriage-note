// 合言葉ゲート（関係者限定の軽い入口）。
// 注意: 静的サイトのため、これは本格的な暗号保護ではなく「関係者以外を入れない」程度の抑止です。
// データは各端末内にのみ保存され、ここを突破しても他人の売上は一切見えません。
//
// 合言葉を変更する手順:
//   1. 端末で  echo -n "新しい合言葉" | shasum -a 256  を実行
//   2. 出力されたハッシュ値で下記 GATE_HASH を置き換える
const GATE_HASH = "a2ed1852c3b9f1d82eaf5f986c13746b396cf0e9f442e50c6a03d005bf0551d7";

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function reveal() {
  document.documentElement.classList.remove("locked");
  const gate = document.getElementById("passGate");
  if (gate) gate.remove();
}

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("gate_ok")) {
    reveal();
    return;
  }

  const form = document.getElementById("passGateForm");
  const input = document.getElementById("passGateInput");
  const errorText = document.getElementById("passGateErr");
  if (!form || !input) return;

  input.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = (input.value || "").trim();
    if (!value) return;

    try {
      const hash = await sha256Hex(value);
      if (hash === GATE_HASH) {
        localStorage.setItem("gate_ok", "1");
        reveal();
        return;
      }
    } catch (error) {
      errorText.textContent = "照合に失敗しました。再度お試しください。";
      return;
    }

    errorText.textContent = "合言葉が違います";
    input.value = "";
    input.focus();
  });
});
