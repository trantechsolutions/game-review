// Coach-password crypto. One PBKDF2 run gives a master secret; HMAC splits it into
//  - accessKey: sent with every notes call; the database keeps only its SHA-256 (keyHash) and
//    never sees the coach password
//  - encKey: AES-256-GCM key for note contents
//  - scope(slug): an opaque per-game id, so the database never stores game names.
// Shared with tools/notes/*.mjs (Node 22 has the same WebCrypto API).
import { aesKey, b64, hmac, open, pbkdf2, seal, toB64, type Bytes } from "./crypto";

export interface NotesKeys { accessKey: string; encRaw: Bytes }

const b64url = (u: Bytes) => toB64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function deriveNotesKeys(password: string, kdf: { salt: string; iterations: number }): Promise<NotesKeys> {
  const master = await pbkdf2(password, b64(kdf.salt), kdf.iterations);
  return {
    accessKey: b64url(new Uint8Array(await hmac(master, "dfc-notes auth"))),
    encRaw: new Uint8Array(await hmac(master, "dfc-notes enc")),
  };
}

/** What the database stores to recognise the access key. */
export async function keyHash(accessKey: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessKey)));
}

export async function scopeFor(encRaw: Bytes, slug: string) {
  return hex(await hmac(encRaw, "dfc-notes scope:", slug)).slice(0, 32);
}

// What a note holds once decrypted. anchor: "game" | "event:<id>" | "section:<page>/<key>".
export interface NoteBody { slug: string; anchor: string; text: string; author: string }

export async function sealNote(encRaw: Bytes, body: NoteBody): Promise<string> {
  const key = await aesKey(encRaw, ["encrypt"]);
  return toB64(await seal(key, new TextEncoder().encode(JSON.stringify(body))));
}

export async function openNote(encRaw: Bytes, data: string): Promise<NoteBody> {
  const key = await aesKey(encRaw, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await open(key, b64(data))));
}
