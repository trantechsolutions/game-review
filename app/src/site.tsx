// Unlocks the site with the team password and loads the encrypted manifest, games and clips.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aesKey, b64, keyStore, open, opaqueName, pbkdf2, readKdf, type Bytes } from "./lib/crypto";
import { CoachContent, Manifest, PublicGame, type Game } from "./schema";

interface Site {
  manifest: Manifest;
  loadGame: (slug: string) => Promise<PublicGame>;
  /** The coaches' breakdown, opened with the coach-password key. */
  loadCoaches: (slug: string, contentKey: Bytes) => Promise<Game["coaches"]>;
  loadClip: (slug: string, id: string, onStage?: (s: "fetch" | "decrypt") => void) => Promise<string>;
  lock: () => void;
}

const Ctx = createContext<Site | null>(null);
export const useSite = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSite outside SiteProvider");
  return v;
};

async function fetchSealed(key: CryptoKey, file: string): Promise<Bytes> {
  const res = await fetch(file, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return open(key, new Uint8Array(await res.arrayBuffer()));
}

const json = (u: Bytes) => JSON.parse(new TextDecoder().decode(u));

export class BadPassword extends Error {}
/** The server answered with a page instead of the encrypted file (e.g. a dev server with no build). */
export class MissingData extends Error {}

// A wrong key derives a manifest name that doesn't exist (404), or, in theory, fails to decrypt.
async function unlock(raw: Bytes) {
  const key = await aesKey(raw);
  const file = await opaqueName(raw, "manifest.json");
  const res = await fetch(file, { cache: "no-cache" });
  if (res.status === 404) throw new BadPassword();
  if (!res.ok) throw new Error(`manifest: ${res.status}`);
  if (/text\/html/.test(res.headers.get("content-type") ?? "")) throw new MissingData();
  let plain: Bytes;
  try { plain = await open(key, new Uint8Array(await res.arrayBuffer())); } catch { throw new BadPassword(); }
  return { key, manifest: Manifest.parse(json(plain)) };
}

type State =
  | { phase: "checking" }
  | { phase: "locked" }
  | { phase: "open"; key: CryptoKey; manifest: Manifest }
  | { phase: "error"; error: unknown };

export function useUnlock() {
  const [state, setState] = useState<State>(() => (keyStore.get() ? { phase: "checking" } : { phase: "locked" }));

  useEffect(() => {
    if (state.phase !== "checking") return;
    const raw = keyStore.get();
    if (!raw) { setState({ phase: "locked" }); return; }
    unlock(raw).then(
      r => setState({ phase: "open", ...r }),
      err => {
        // A stored key that no longer works (password changed) is dropped; a network error is not.
        if (err instanceof BadPassword) { keyStore.clear(); setState({ phase: "locked" }); }
        else setState({ phase: "error", error: err });
      });
  }, [state.phase]);

  const submit = useCallback(async (password: string, remember: boolean) => {
    const kdf = readKdf();
    const raw = await pbkdf2(password, b64(kdf.salt), kdf.iterations);
    const r = await unlock(raw);
    keyStore.set(raw, remember);
    setState({ phase: "open", ...r });
  }, []);

  const retry = useCallback(() => setState({ phase: "checking" }), []);
  return { state, submit, retry };
}

export function SiteContext({ keyObj, manifest, children }: { keyObj: CryptoKey; manifest: Manifest; children: ReactNode }) {
  const games = useRef(new Map<string, Promise<PublicGame>>());
  const coaches = useRef(new Map<string, Promise<Game["coaches"]>>());
  const clips = useRef(new Map<string, string>());

  const value = useMemo<Site>(() => ({
    manifest,
    loadGame: slug => {
      let p = games.current.get(slug);
      if (!p) {
        const entry = manifest.games.find(g => g.slug === slug);
        if (!entry) return Promise.reject(new Error("not found"));
        p = fetchSealed(keyObj, entry.file).then(u => PublicGame.parse(json(u)));
        p.catch(() => games.current.delete(slug));
        games.current.set(slug, p);
      }
      return p;
    },
    loadCoaches: (slug, contentKey) => {
      let p = coaches.current.get(slug);
      if (!p) {
        const entry = manifest.games.find(g => g.slug === slug);
        if (!entry) return Promise.reject(new Error("not found"));
        p = aesKey(contentKey).then(k => fetchSealed(k, entry.coachFile)).then(u => CoachContent.parse(json(u)).coaches);
        p.catch(() => coaches.current.delete(slug));
        coaches.current.set(slug, p);
      }
      return p;
    },
    loadClip: async (slug, id, onStage) => {
      const k = `${slug}/${id}`;
      const cached = clips.current.get(k);
      if (cached) return cached;
      const c = manifest.clips[k];
      if (!c) throw new Error("no such clip");
      onStage?.("fetch");
      const res = await fetch(c.file);
      if (!res.ok) throw new Error(String(res.status));
      const data = new Uint8Array(await res.arrayBuffer());
      onStage?.("decrypt");
      const url = URL.createObjectURL(new Blob([await open(keyObj, data)], { type: "video/mp4" }));
      clips.current.set(k, url);
      return url;
    },
    lock: () => { keyStore.clear(); location.hash = "#/"; location.reload(); },
  }), [keyObj, manifest]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
