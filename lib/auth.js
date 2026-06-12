export const PBKDF2_ITERATIONS = 120000;

const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function createSalt(length = 16) {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

export async function hashPassword(password, saltBase64 = createSalt()) {
  if (!password || String(password).length < 4) {
    throw new Error("パスワードは4文字以上で入力してください。");
  }
  const hashBytes = await derivePassword(String(password), base64ToBytes(saltBase64));
  return {
    passwordHash: bytesToBase64(hashBytes),
    salt: saltBase64,
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function verifyPassword(password, saltBase64, expectedHashBase64) {
  if (!password || !saltBase64 || !expectedHashBase64) return false;
  const { passwordHash } = await hashPassword(String(password), saltBase64);
  const actual = base64ToBytes(passwordHash);
  const expected = base64ToBytes(expectedHashBase64);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}
