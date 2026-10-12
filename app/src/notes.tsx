// Coach notes: sign in with the coach password, then read and write encrypted notes in Supabase.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COACH_EMAIL, NOTES_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { b64, toB64, type Bytes } from "./lib/crypto";
import { deriveNotesKeys, openNote, scopeFor, sealNote, type NoteBody } from "./lib/notesCrypto";

const KEY_STORE = "dfc-notes-key";
const REMEMBER = "dfc-notes-remember";
const TABLE = "coach_notes";

export interface Note extends NoteBody { id: string; updatedAt: string }

const remembered = () => { try { return localStorage.getItem(REMEMBER) === "1"; } catch { return false; } };
const storage = (remember: boolean) => { try { return remember ? localStorage : sessionStorage; } catch { return undefined; } };

function client(remember: boolean): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: storage(remember), storageKey: "dfc-notes-auth" },
  });
}

const loadKey = (): Bytes | null => {
  try { const s = sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); return s ? b64(s) : null; } catch { return null; }
};

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

interface Row { id: string; scope: string; data: string; updated_at: string }

export function NotesProvider({ children }: { children: ReactNode }) {
  const [sb, setSb] = useState<SupabaseClient>(() => client(remembered()));
  const [encRaw, setEncRaw] = useState<Bytes | null>(loadKey);
  const [session, setSession] = useState(false);
  const [version, setVersion] = useState(0);
  const [drawer, setDrawer] = useState<NotesApi["drawer"]>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(!!s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const forget = useCallback(() => {
    try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); localStorage.removeItem(REMEMBER); } catch { /* nothing stored */ }
    setEncRaw(null);
  }, []);

  const signIn = useCallback(async (password: string, remember: boolean) => {
    const keys = await deriveNotesKeys(password, NOTES_KDF);
    const c = client(remember);
    const { error } = await c.auth.signInWithPassword({ email: COACH_EMAIL, password: keys.authPassword });
    if (error) throw error.status === 400 ? new BadCoachPassword() : error;
    try {
      sessionStorage.setItem(KEY_STORE, toB64(keys.encRaw));
      if (remember) { localStorage.setItem(KEY_STORE, toB64(keys.encRaw)); localStorage.setItem(REMEMBER, "1"); }
    } catch { /* storage blocked: signed in for this page only */ }
    setSb(c);
    setEncRaw(keys.encRaw);
    setSession(true);
  }, []);

  const signOut = useCallback(async () => {
    await sb.auth.signOut().catch(() => undefined);
    forget();
    setSession(false);
    setDrawer(null);
  }, [sb, forget]);

  const signedIn = session && !!encRaw;

  const api = useMemo<NotesApi>(() => ({
    signedIn, signIn, signOut, version, drawer, loginOpen, setLoginOpen,
    openDrawer: (slug, anchor, label) => setDrawer({ slug, anchor, label }),
    closeDrawer: () => setDrawer(null),
    list: async slug => {
      if (!encRaw) return [];
      const scope = await scopeFor(encRaw, slug);
      const { data, error } = await sb.from(TABLE).select("id, scope, data, updated_at").eq("scope", scope).order("updated_at");
      if (error) throw error;
      const out: Note[] = [];
      for (const r of (data ?? []) as Row[]) {
        try { out.push({ ...(await openNote(encRaw, r.data)), id: r.id, updatedAt: r.updated_at }); }
        catch { /* written with another coach password: skip */ }
      }
      return out;
    },
    save: async note => {
      if (!encRaw) throw new Error("signed out");
      const data = await sealNote(encRaw, { slug: note.slug, anchor: note.anchor, text: note.text, author: note.author });
      const scope = await scopeFor(encRaw, note.slug);
      const { error } = note.id
        ? await sb.from(TABLE).update({ data, updated_at: new Date().toISOString() }).eq("id", note.id)
        : await sb.from(TABLE).insert({ scope, data });
      if (error) throw error;
      setVersion(v => v + 1);
    },
    remove: async id => {
      const { error } = await sb.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      setVersion(v => v + 1);
    },
  }), [signedIn, signIn, signOut, version, drawer, loginOpen, encRaw, sb]);

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
