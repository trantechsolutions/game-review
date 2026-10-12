// Team-password crypto, matching tools/build.mjs: PBKDF2-SHA256 → AES-256-GCM, files laid out
// as iv (12 bytes) || ciphertext || tag. Published names are HMAC-derived from the same key.
export type Bytes = Uint8Array<ArrayBuffer>;
const STORE = "dfc-film-key";

export const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const toB64 = (u: Bytes) => btoa(String.fromCharCode(...u));
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map(b => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface Kdf { salt: string; iterations: number }

export function readKdf(): Kdf {
  const el = document.getElementById("kdf");
  if (!el?.textContent) throw new Error("missing kdf settings");
  return JSON.parse(el.textContent);
}

export async function pbkdf2(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const base = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

export async function hmac(key: Bytes, ...parts: (string | Bytes)[]): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const chunks = parts.map(p => (typeof p === "string" ? utf8(p) : p));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return crypto.subtle.sign("HMAC", k, all);
}

export async function aesKey(raw: Bytes, usages: KeyUsage[] = ["decrypt"]) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usages);
}

export async function open(key: CryptoKey, data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12)));
}

export async function seal(key: CryptoKey, plain: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

// The published name of a source path, e.g. "manifest.json" → "3f9c…e1.bin".
export async function opaqueName(raw: Bytes, path: string): Promise<string> {
  const nameKey = new Uint8Array(await hmac(raw, "dfc-film name derivation"));
  return hex(await hmac(nameKey, path)).slice(0, 20) + ".bin";
}

export const keyStore = {
  get(): Bytes | null {
    try { const s = sessionStorage.getItem(STORE) || localStorage.getItem(STORE); return s ? b64(s) : null; } catch { return null; }
  },
  set(raw: Bytes, remember: boolean) {
    try { sessionStorage.setItem(STORE, toB64(raw)); if (remember) localStorage.setItem(STORE, toB64(raw)); } catch { /* storage blocked */ }
  },
  clear() {
    try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch { /* nothing stored */ }
  },
};
