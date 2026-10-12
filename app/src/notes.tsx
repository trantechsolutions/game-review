// Coach notes: unlock with the coach password, then read and write encrypted notes in Supabase.
// There are no accounts. The password derives an encryption key and an access key; the notes
// functions in the database (tools/notes/setup.sql) only answer to the access key.
import { createClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NOTES_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { b64, toB64, type Bytes } from "./lib/crypto";
import { deriveNotesKeys, openNote, scopeFor, sealNote, type NoteBody } from "./lib/notesCrypto";

const STORE = "dfc-notes-keys";

export interface Note extends NoteBody { id: string; updatedAt: string }

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

interface Keys { accessKey: string; encRaw: Bytes }

const loadKeys = (): Keys | null => {
  try {
    const s = sessionStorage.getItem(STORE) || localStorage.getItem(STORE);
    if (!s) return null;
    const { a, e } = JSON.parse(s);
    return { accessKey: a, encRaw: b64(e) };
  } catch { return null; }
};
const saveKeys = (k: Keys, remember: boolean) => {
  try {
    const s = JSON.stringify({ a: k.accessKey, e: toB64(k.encRaw) });
    sessionStorage.setItem(STORE, s);
    if (remember) localStorage.setItem(STORE, s);
  } catch { /* storage blocked: unlocked for this page only */ }
};
const clearKeys = () => { try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch { /* nothing stored */ } };

export class BadCoachPassword extends Error {}

interface NotesApi {
  signedIn: boolean;
  signIn: (password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  list: (slug: string) => Promise<Note[]>;
  save: (note: Omit<Note, "id" | "updatedAt"> & { id?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Bumps whenever a note is saved or removed, so open views can refetch. */
  version: number;
  /** Which anchor the notes drawer is showing, if open. */
  drawer: { slug: string; anchor: string; label: string } | null;
  openDrawer: (slug: string, anchor: string, label: string) => void;
  closeDrawer: () => void;
  loginOpen: boolean;
  setLoginOpen: (v: boolean) => void;
}

const Ctx = createContext<NotesApi | null>(null);
export const useNotes = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotes outside NotesProvider");
  return v;
};

interface Row { id: string; data: string; updated_at: string }

export function NotesProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Keys | null>(loadKeys);
  const [version, setVersion] = useState(0);
  const [drawer, setDrawer] = useState<NotesApi["drawer"]>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // A remembered key that no longer works (the coach password changed) is dropped.
  useEffect(() => {
    if (!keys) return;
    sb.rpc("notes_check", { p_key: keys.accessKey }).then(({ data, error }) => {
      if (!error && data === false) { clearKeys(); setKeys(null); }
    });
  }, [keys]);

  const signIn = useCallback(async (password: string, remember: boolean) => {
    const k = await deriveNotesKeys(password, NOTES_KDF);
    const { data, error } = await sb.rpc("notes_check", { p_key: k.accessKey });
    if (error) throw error;
    if (data !== true) throw new BadCoachPassword();
    saveKeys(k, remember);
    setKeys(k);
  }, []);

  const signOut = useCallback(async () => { clearKeys(); setKeys(null); setDrawer(null); }, []);

  const api = useMemo<NotesApi>(() => ({
    signedIn: !!keys, signIn, signOut, version, drawer, loginOpen, setLoginOpen,
    openDrawer: (slug, anchor, label) => setDrawer({ slug, anchor, label }),
    closeDrawer: () => setDrawer(null),
    list: async slug => {
      if (!keys) return [];
      const { data, error } = await sb.rpc("notes_list", { p_key: keys.accessKey, p_scope: await scopeFor(keys.encRaw, slug) });
      if (error) throw error;
      const out: Note[] = [];
      for (const r of (data ?? []) as Row[]) {
        try { out.push({ ...(await openNote(keys.encRaw, r.data)), id: r.id, updatedAt: r.updated_at }); }
        catch { /* written under another coach password: skip */ }
      }
      return out;
    },
    save: async note => {
      if (!keys) throw new Error("locked");
      const { error } = await sb.rpc("notes_save", {
        p_key: keys.accessKey, p_id: note.id ?? null,
        p_scope: await scopeFor(keys.encRaw, note.slug),
        p_data: await sealNote(keys.encRaw, { slug: note.slug, anchor: note.anchor, text: note.text, author: note.author }),
      });
      if (error) throw error;
      setVersion(v => v + 1);
    },
    remove: async id => {
      if (!keys) throw new Error("locked");
      const { error } = await sb.rpc("notes_delete", { p_key: keys.accessKey, p_id: id });
      if (error) throw error;
      setVersion(v => v + 1);
    },
  }), [keys, signIn, signOut, version, drawer, loginOpen]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Notes for one game, refetched whenever any note changes. */
export function useGameNotes(slug: string) {
  const { signedIn, list, version } = useNotes();
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!signedIn) { setNotes([]); return; }
    let live = true;
    list(slug).then(n => { if (live) { setNotes(n); setError(null); } }, e => { if (live) setError(e); });
    return () => { live = false; };
  }, [signedIn, slug, version, list]);
  return { notes, error };
}
