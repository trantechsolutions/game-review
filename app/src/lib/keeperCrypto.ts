// Scorekeeper-password crypto. One PBKDF2 run gives a master secret; HMAC splits it into
//  - accessKey: sent with every stat-log call; the database keeps only its SHA-256 and never sees the password
//  - encRaw: AES-256-GCM key for log entries
//  - rosterRaw: opens the keeper roster (names, numbers, positions), which tools/build.mjs seals with the
//    same derivation; its file name is HMAC-derived from it, so a wrong password finds no file
//  - scope(slug): an opaque per-game id, so the database never stores game names.
// Shared with tools/keeper/keeper.ts (Node 22 has the same WebCrypto API).
import { aesKey, b64, hmac, open, pbkdf2, seal, toB64, type Bytes } from "./crypto";

export interface KeeperKeys { accessKey: string; encRaw: Bytes; rosterRaw: Bytes }

const b64url = (u: Bytes) => toB64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map(b => b.toString(16).padStart(2, "0")).join("");

export const KEEPER_ROSTER_PATH = "keeper/roster.json";

export async function deriveKeeperKeys(password: string, kdf: { salt: string; iterations: number }): Promise<KeeperKeys> {
  const master = await pbkdf2(password, b64(kdf.salt), kdf.iterations);
  return {
    accessKey: b64url(new Uint8Array(await hmac(master, "dfc-keeper auth"))),
    encRaw: new Uint8Array(await hmac(master, "dfc-keeper enc")),
    rosterRaw: new Uint8Array(await hmac(master, "dfc-keeper roster")),
  };
}

export async function keeperScope(encRaw: Bytes, slug: string) {
  return hex(await hmac(encRaw, "dfc-keeper scope:", slug)).slice(0, 32);
}

export async function sealEntry(encRaw: Bytes, entry: unknown): Promise<string> {
  const key = await aesKey(encRaw, ["encrypt"]);
  return toB64(await seal(key, new TextEncoder().encode(JSON.stringify(entry))));
}

export async function openEntry(encRaw: Bytes, data: string): Promise<unknown> {
  const key = await aesKey(encRaw, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await open(key, b64(data))));
}
