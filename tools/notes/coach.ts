// Coach-notes admin, run on the coach's PC. Reads the coach password from private/.coach-password
// (one line, never committed).
//
//   npx tsx tools/notes/coach.ts auth-password   prints the Supabase password for the shared coach
//                                               user (derived from the coach password; it is not
//                                               the coach password itself)
//   npx tsx tools/notes/coach.ts check           signs in, writes, reads and deletes a test note
//   npx tsx tools/notes/coach.ts rotate          changes the coach password to private/.coach-password.new:
//                                               re-encrypts every note, updates the Supabase password,
//                                               then replaces .coach-password
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COACH_EMAIL, NOTES_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "../../app/src/config";
import { deriveNotesKeys, openNote, scopeFor, sealNote, type NotesKeys } from "../../app/src/lib/notesCrypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PW = join(ROOT, "private", ".coach-password");
const NEW_PW = join(ROOT, "private", ".coach-password.new");
const TABLE = "coach_notes";

const readPw = (f: string) => {
  if (!existsSync(f)) { console.error(`Put the coach password on one line in ${f} (never committed).`); process.exit(1); }
  const pw = readFileSync(f, "utf8").replace(/^﻿/, "").replace(/\r?\n$/, "");
  if (pw.length < 12) console.warn("warning: use a coach password of at least 12 characters.");
  return pw;
};

async function signIn(keys: NotesKeys) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: COACH_EMAIL, password: keys.authPassword });
  if (error) { console.error(`Sign-in failed: ${error.message}. Is the coach user created with the password from "auth-password"?`); process.exit(1); }
  return sb;
}

const cmd = process.argv[2];
const keys = await deriveNotesKeys(readPw(PW), NOTES_KDF);

if (cmd === "auth-password") {
  console.log(`email:    ${COACH_EMAIL}\npassword: ${keys.authPassword}`);
} else if (cmd === "check") {
  const sb = await signIn(keys);
  const slug = "0000-00-00-check";
  const data = await sealNote(keys.encRaw, { slug, anchor: "game", text: "connection check", author: "" });
  const ins = await sb.from(TABLE).insert({ scope: await scopeFor(keys.encRaw, slug), data }).select("id").single();
  if (ins.error) { console.error(`insert failed: ${ins.error.message} (has tools/notes/setup.sql been run?)`); process.exit(1); }
  const got = await sb.from(TABLE).select("data").eq("id", ins.data.id).single();
  if (got.error) { console.error(`read failed: ${got.error.message}`); process.exit(1); }
  const body = await openNote(keys.encRaw, got.data.data);
  const del = await sb.from(TABLE).delete().eq("id", ins.data.id);
  if (del.error) { console.error(`delete failed: ${del.error.message}`); process.exit(1); }
  // Signed out, the table must be invisible.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const leak = await anon.from(TABLE).select("id").limit(1);
  if (!leak.error && leak.data.length) { console.error("✗ notes are readable without signing in. Re-run setup.sql."); process.exit(1); }
  console.log(`✓ coach notes work: wrote, read ("${body.text}") and deleted a note; nothing readable signed out`);
} else if (cmd === "rotate") {
  const next = await deriveNotesKeys(readPw(NEW_PW), NOTES_KDF);
  const sb = await signIn(keys);
  const { data, error } = await sb.from(TABLE).select("id, data");
  if (error) { console.error(error.message); process.exit(1); }
  let n = 0;
  for (const row of data) {
    // A rerun after a failed rotation finds some rows already under the new key; leave those.
    const body = await openNote(keys.encRaw, row.data).catch(() => null);
    if (!body) { await openNote(next.encRaw, row.data); continue; }
    const upd = await sb.from(TABLE).update({ scope: await scopeFor(next.encRaw, body.slug), data: await sealNote(next.encRaw, body) }).eq("id", row.id);
    if (upd.error) { console.error(`stopped after ${n} notes: ${upd.error.message}. Run rotate again with the same files.`); process.exit(1); }
    n++;
  }
  const pw = await sb.auth.updateUser({ password: next.authPassword });
  if (pw.error) { console.error(`notes re-encrypted but the password change failed: ${pw.error.message}`); process.exit(1); }
  renameSync(NEW_PW, PW);
  console.log(`✓ re-encrypted ${n} notes; the new coach password is live. Coaches signed in on other devices must sign in again.`);
} else {
  console.error("usage: npx tsx tools/notes/coach.ts auth-password | check | rotate");
  process.exit(1);
}
