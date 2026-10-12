// Coach-notes admin, run on the coach's PC. Reads the coach password from private/.coach-password
// (one line, never committed).
//
//   npx tsx tools/notes/coach.ts setup-sql   writes private/notes-setup.sql: tools/notes/setup.sql with the
//                                           coach key's fingerprint filled in. Paste it into Supabase → SQL Editor.
//   npx tsx tools/notes/coach.ts check       writes, reads and deletes a test note, and confirms the notes
//                                           can't be reached without the coach password
//   npx tsx tools/notes/coach.ts rotate      changes the coach password to private/.coach-password.new:
//                                           re-encrypts every note, switches the database to the new key,
//                                           then replaces .coach-password
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTES_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "../../app/src/config";
import { deriveNotesKeys, keyHash, openNote, scopeFor, sealNote } from "../../app/src/lib/notesCrypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PW = join(ROOT, "private", ".coach-password");
const NEW_PW = join(ROOT, "private", ".coach-password.new");
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const readPw = (f: string) => {
  if (!existsSync(f)) fail(`Put the coach password on one line in ${f} (never committed).`);
  const pw = readFileSync(f, "utf8").replace(/^﻿/, "").trim();
  if (!pw) fail(`${f} is empty. Save the coach password in it (one line) first.`);
  if (pw.length < 12) console.warn("warning: use a coach password of at least 12 characters; the notes are only as safe as it is.");
  return pw;
};

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const cmd = process.argv[2];
const keys = await deriveNotesKeys(readPw(PW), NOTES_KDF);

async function requireKey(k: string) {
  const { data, error } = await sb.rpc("notes_check", { p_key: k });
  if (error) fail(`The notes functions aren't set up: ${error.message}. Run setup-sql and paste private/notes-setup.sql into Supabase.`);
  if (data !== true) fail("The database doesn't accept this coach password. Run setup-sql again and paste the new file.");
}

if (cmd === "setup-sql") {
  const sql = readFileSync(join(ROOT, "tools", "notes", "setup.sql"), "utf8").replace("__KEY_HASH__", await keyHash(keys.accessKey));
  const out = join(ROOT, "private", "notes-setup.sql");
  writeFileSync(out, sql);
  console.log(`wrote ${out}\nPaste it into Supabase → SQL Editor → Run, then run: npx tsx tools/notes/coach.ts check`);
} else if (cmd === "check") {
  await requireKey(keys.accessKey);
  const slug = "0000-00-00-check";
  const scope = await scopeFor(keys.encRaw, slug);
  const data = await sealNote(keys.encRaw, { slug, anchor: "game", text: "connection check", author: "" });
  const saved = await sb.rpc("notes_save", { p_key: keys.accessKey, p_id: null, p_scope: scope, p_data: data });
  if (saved.error) fail(`save failed: ${saved.error.message}`);
  const listed = await sb.rpc("notes_list", { p_key: keys.accessKey, p_scope: scope });
  if (listed.error) fail(`list failed: ${listed.error.message}`);
  const row = (listed.data as { id: string; data: string }[]).find(r => r.id === saved.data);
  if (!row) fail("the saved note didn't come back");
  const body = await openNote(keys.encRaw, row!.data);
  // Without the coach key, nothing is reachable.
  const direct = await sb.from("coach_notes").select("id").limit(1);
  const guessed = await sb.rpc("notes_list", { p_key: "not-the-key", p_scope: null });
  const del = await sb.rpc("notes_delete", { p_key: keys.accessKey, p_id: saved.data });
  if (del.error) fail(`delete failed: ${del.error.message}`);
  if (!direct.error && direct.data.length) fail("✗ the notes table is readable without the coach password. Re-run the setup SQL.");
  if (!guessed.error) fail("✗ the notes functions answered a wrong key. Re-run the setup SQL.");
  console.log(`✓ coach notes work: saved, read ("${body.text}") and deleted a note; a wrong key and direct table access are refused`);
} else if (cmd === "rotate") {
  const next = await deriveNotesKeys(readPw(NEW_PW), NOTES_KDF);
  await requireKey(keys.accessKey);
  const { data, error } = await sb.rpc("notes_list", { p_key: keys.accessKey, p_scope: null });
  if (error) fail(error.message);
  let n = 0;
  for (const row of data as { id: string; data: string }[]) {
    // A rerun after a failed rotation finds some rows already under the new key; leave those.
    const body = await openNote(keys.encRaw, row.data).catch(() => null);
    if (!body) { await openNote(next.encRaw, row.data); continue; }
    const upd = await sb.rpc("notes_save", { p_key: keys.accessKey, p_id: row.id, p_scope: await scopeFor(next.encRaw, body.slug), p_data: await sealNote(next.encRaw, body) });
    if (upd.error) fail(`stopped after ${n} notes: ${upd.error.message}. Run rotate again with the same files.`);
    n++;
  }
  const set = await sb.rpc("notes_set_key", { p_key: keys.accessKey, p_new_hash: await keyHash(next.accessKey) });
  if (set.error) fail(`notes re-encrypted but switching the key failed: ${set.error.message}. Run rotate again.`);
  renameSync(NEW_PW, PW);
  console.log(`✓ re-encrypted ${n} notes; the new coach password is live. Coaches must unlock again with it.`);
} else {
  fail("usage: npx tsx tools/notes/coach.ts setup-sql | check | rotate");
}
