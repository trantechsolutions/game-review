// The scorekeeper: unlock with the scorekeeper password (no team or coach password), then keep a game's
// stat log. Every tap is saved on this device first and sent to Supabase, encrypted, whenever there is a
// connection, so a dead spot at the field loses nothing and a second phone can pick the game up.
// The stat-log functions (tools/keeper/setup.sql) only answer to the access key the password derives.
// Opened from NOLA DFC Manager, the scorekeeper also has a token for their own account: entries then go
// through keeper_*_as (nola-dfc-manager/sql/keeper_accounts_migration.sql), which records who sent them
// and stops working when the account loses the scorekeeper or coach role. The password still works for a
// volunteer without an account.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KEEPER_KDF } from "./config";
import { aesKey, b64, open, opaqueName, toB64 } from "./lib/crypto";
import { deriveKeeperKeys, keeperScope, KEEPER_ROSTER_PATH, openEntry, sealEntry, type KeeperKeys } from "./lib/keeperCrypto";
import { KeepEntry, KeeperRoster } from "./schema";
import { sb } from "./supabase";

const KEYS = "dfc-keeper-keys";
const ROSTER = "dfc-keeper-roster";
const LOG = "dfc-keeper-log:";   // + slug: { entries, sent }
const INDEX = "dfc-keeper-games";
const FORGOT = "dfc-keeper-deleted"; // games deleted here, still to be removed from the stat log

const read = <T,>(k: string): T | null => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: kept in memory */ } };
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } };

const loadKeys = (): KeeperKeys | null => {
  const k = read<{ a: string; e: string; r: string }>(KEYS);
  return k ? { accessKey: k.a, encRaw: b64(k.e), rosterRaw: b64(k.r) } : null;
};
/** The manager account's scorekeeper token, when the keys came from the manager. */
const loadToken = () => read<{ u?: string }>(KEYS)?.u ?? null;

export class BadKeeperPassword extends Error {}

/** "expired": the manager account's token no longer works (expired, or the role was taken away). */
export type SyncState = "idle" | "sending" | "offline" | "error" | "expired";

interface Log { entries: KeepEntry[]; sent: Set<string> }

interface KeeperApi {
  signedIn: boolean;
  /** Unlocked, but the roster hasn't loaded yet (first sign-in on this device needs a connection). */
  hasKeys: boolean;
  roster: KeeperRoster | null;
  signIn: (password: string) => Promise<void>;
  signOut: () => void;
  /** Games on this device (and any pulled from other devices), newest first. */
  games: string[];
  entries: (slug: string) => KeepEntry[];
  append: (slug: string, e: KeepEntry) => void;
  /** Fetches every game's entries from other devices. */
  refresh: () => Promise<void>;
  /** Deletes a game from this device and from the stat log (now, or once back online). */
  forget: (slug: string) => void;
  sync: { state: SyncState; pending: number; error: string };
  version: number;
}

const Ctx = createContext<KeeperApi | null>(null);
export const useKeeper = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKeeper outside KeeperProvider");
  return v;
};

async function fetchRoster(k: KeeperKeys): Promise<KeeperRoster> {
  const file = await opaqueName(k.rosterRaw, KEEPER_ROSTER_PATH);
  const res = await fetch(file, { cache: "no-cache" });
  if (res.status === 404 || /text\/html/.test(res.headers.get("content-type") ?? "")) throw new BadKeeperPassword();
  if (!res.ok) throw new Error(`roster: ${res.status}`);
  let plain: Uint8Array;
  try { plain = await open(await aesKey(k.rosterRaw), new Uint8Array(await res.arrayBuffer())); } catch { throw new BadKeeperPassword(); }
  return KeeperRoster.parse(JSON.parse(new TextDecoder().decode(plain)));
}

interface Row { id: string; scope: string; data: string }

export function KeeperProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<KeeperKeys | null>(loadKeys);
  const [token, setToken] = useState<string | null>(loadToken);
  const [roster, setRoster] = useState<KeeperRoster | null>(() => (keys ? read<KeeperRoster>(ROSTER) : null));
  const [games, setGames] = useState<string[]>(() => read<string[]>(INDEX) ?? []);
  const [version, setVersion] = useState(0);
  const [sync, setSync] = useState<KeeperApi["sync"]>({ state: "idle", pending: 0, error: "" });
  const logs = useRef(new Map<string, Log>());
  const busy = useRef(false);

  const logOf = useCallback((slug: string): Log => {
    let l = logs.current.get(slug);
    if (!l) {
      const s = read<{ entries: KeepEntry[]; sent: string[] }>(LOG + slug);
      l = { entries: s?.entries ?? [], sent: new Set(s?.sent ?? []) };
      logs.current.set(slug, l);
    }
    return l;
  }, []);
  const save = (slug: string, l: Log) => write(LOG + slug, { entries: l.entries, sent: [...l.sent] });
  const addGame = useCallback((slug: string) => {
    setGames(g => {
      if (g.includes(slug)) return g;
      const next = [...g, slug].sort().reverse();
      write(INDEX, next);
      return next;
    });
  }, []);
  const pendingCount = useCallback(() => {
    let n = 0;
    for (const slug of read<string[]>(INDEX) ?? []) { const l = logOf(slug); n += l.entries.filter(e => !l.sent.has(e.id)).length; }
    return n;
  }, [logOf]);

  // A remembered roster refreshes quietly (it changes when the coach rebuilds); offline, the stored one stays.
  useEffect(() => {
    if (!keys) return;
    fetchRoster(keys).then(r => { setRoster(r); write(ROSTER, r); }, err => {
      if (err instanceof BadKeeperPassword) { drop(KEYS); drop(ROSTER); setKeys(null); setToken(null); setRoster(null); }
    });
  }, [keys]);

  // The stat-log calls: as the manager account when there's a token, else with the password's access key.
  const call = useCallback((fn: "append" | "list" | "forget", args: Record<string, unknown>) =>
    token ? sb.rpc(`keeper_${fn}_as`, { p_token: token, ...args }) : sb.rpc(`keeper_${fn}`, { p_key: keys!.accessKey, ...args }), [token, keys]);
  const expired = (code?: string) => !!token && code === "42501";

  const flush = useCallback(async () => {
    if (!keys || busy.current) return;
    // Deleted games first, so nothing is re-sent for them and other phones stop pulling them back.
    const forgotten = read<string[]>(FORGOT) ?? [];
    if (forgotten.length && navigator.onLine) {
      const left: string[] = [];
      for (const slug of forgotten) {
        const { error } = await call("forget", { p_scope: await keeperScope(keys.encRaw, slug) });
        if (error) left.push(slug);
      }
      if (left.length) write(FORGOT, left); else drop(FORGOT);
    }
    const todo: { slug: string; e: KeepEntry }[] = [];
    for (const slug of read<string[]>(INDEX) ?? []) {
      const l = logOf(slug);
      for (const e of l.entries) if (!l.sent.has(e.id)) todo.push({ slug, e });
    }
    if (!todo.length) { setSync(s => ({ ...s, state: "idle", pending: 0, error: "" })); return; }
    if (!navigator.onLine) { setSync({ state: "offline", pending: todo.length, error: "" }); return; }
    busy.current = true;
    setSync({ state: "sending", pending: todo.length, error: "" });
    try {
      for (let i = 0; i < todo.length; i += 200) {
        const batch = todo.slice(i, i + 200);
        const rows = await Promise.all(batch.map(async ({ slug, e }) => ({ id: e.id, scope: await keeperScope(keys.encRaw, slug), data: await sealEntry(keys.encRaw, e) })));
        const { error } = await call("append", { p_rows: rows });
        if (error) throw Object.assign(new Error(error.message), { code: error.code });
        for (const { slug, e } of batch) logOf(slug).sent.add(e.id);
        for (const slug of new Set(batch.map(b => b.slug))) save(slug, logOf(slug));
      }
      setSync({ state: "idle", pending: 0, error: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const state = expired((err as { code?: string }).code) ? "expired" : navigator.onLine && !/fetch/i.test(msg) ? "error" : "offline";
      setSync({ state, pending: pendingCount(), error: msg });
    } finally { busy.current = false; }
  }, [keys, logOf, pendingCount, call, expired]);

  // Retry whatever is waiting: when the connection comes back, and every 15 s.
  useEffect(() => {
    if (!keys) return;
    flush();
    const on = () => flush();
    window.addEventListener("online", on);
    const t = setInterval(flush, 15000);
    return () => { window.removeEventListener("online", on); clearInterval(t); };
  }, [keys, flush]);

  const refresh = useCallback(async () => {
    if (!keys || !navigator.onLine) return;
    const { data, error } = await call("list", { p_scope: null });
    if (error) { setSync(s => ({ ...s, state: expired(error.code) ? "expired" : "error", error: error.message })); return; }
    const byScope = new Map<string, KeepEntry[]>();
    for (const r of (data ?? []) as Row[]) {
      try {
        const e = KeepEntry.parse(await openEntry(keys.encRaw, r.data));
        byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), e]);
      } catch { /* written under another scorekeeper password: skip */ }
    }
    let changed = false;
    for (const entries of byScope.values()) {
      const slug = entries.find(e => e.k === "setup")?.setup.slug;
      if (!slug || (read<string[]>(FORGOT) ?? []).includes(slug)) continue;
      const l = logOf(slug);
      const have = new Set(l.entries.map(e => e.id));
      for (const e of entries) {
        l.sent.add(e.id);
        if (!have.has(e.id)) { l.entries.push(e); changed = true; }
      }
      save(slug, l);
      addGame(slug);
    }
    if (changed) setVersion(v => v + 1);
  }, [keys, logOf, addGame, call, expired]);

  const signIn = useCallback(async (password: string) => {
    const k = await deriveKeeperKeys(password, KEEPER_KDF);
    const r = await fetchRoster(k);
    write(KEYS, { a: k.accessKey, e: toB64(k.encRaw), r: toB64(k.rosterRaw) });
    write(ROSTER, r);
    setRoster(r);
    setToken(null);
    setKeys(k);
  }, []);

  // Signing out keeps the logs on the device: anything not yet sent would otherwise be lost.
  const signOut = useCallback(() => { drop(KEYS); drop(ROSTER); setKeys(null); setToken(null); setRoster(null); }, []);

  const flushSoon = useRef<ReturnType<typeof setTimeout>>(undefined);
  const forget = useCallback((slug: string) => {
    write(FORGOT, [...new Set([...(read<string[]>(FORGOT) ?? []), slug])]);
    logs.current.delete(slug);
    drop(LOG + slug);
    setGames(g => { const next = g.filter(x => x !== slug); write(INDEX, next); return next; });
    setVersion(v => v + 1);
    clearTimeout(flushSoon.current);
    flushSoon.current = setTimeout(flush, 100);
  }, [flush]);
  const append = useCallback((slug: string, e: KeepEntry) => {
    const l = logOf(slug);
    l.entries.push(KeepEntry.parse(e));
    save(slug, l);
    addGame(slug);
    setVersion(v => v + 1);
    setSync(s => ({ ...s, pending: s.pending + 1 }));
    clearTimeout(flushSoon.current);
    flushSoon.current = setTimeout(flush, 400);
  }, [logOf, addGame, flush]);

  const api = useMemo<KeeperApi>(() => ({
    signedIn: !!keys && !!roster, hasKeys: !!keys, roster, signIn, signOut, games, append, refresh, forget, sync, version,
    entries: slug => logOf(slug).entries,
  }), [keys, roster, signIn, signOut, games, append, refresh, forget, sync, version, logOf]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
