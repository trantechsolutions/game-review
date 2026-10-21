// Opening this site from NOLA DFC Manager: the manager links here with the keys its signed-in user may have,
// in the fragment ("#unlock=<base64url JSON>"), which browsers never send to a server. They are stored the way
// typing the passwords would store them, and the address is replaced so they don't stay in the tab's history.
//
//   t  the games key (what the team password derives), base64
//   c  the coach keys { a, e, c } (coach notes access, notes, breakdowns)
//   k  the scorekeeper keys { a, e, r } (stat-log access, logs, squad list), and u: the signed-in manager
//      user's scorekeeper token, so their entries are sent as them (keeper_*_as in the manager's SQL)
//   to where to land: "season" (the site), "keep" (the scorekeeper screen) or "game" (one game's page)
//   g  with "game": the game's slug;  p  its page, "report" or "highlights"
export interface Unlock {
  t?: string;
  c?: { a: string; e: string; c: string };
  k?: { a: string; e: string; r: string; u?: string };
  to: "season" | "keep" | "game";
  g?: string;
  p?: "report" | "highlights";
}

const SLUG = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const isB64 = (v: unknown): v is string => typeof v === "string" && v.length >= 16 && B64.test(v);

/** The keys in a "#unlock=…" fragment, or null when there are none (or they don't look right). */
export function readUnlock(hash: string): Unlock | null {
  const m = /^#unlock=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  let p: Record<string, unknown>;
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
  } catch { return null; }
  if (!p || p.v !== 1) return null;
  const c = p.c as Unlock["c"] | undefined, k = p.k as Unlock["k"] | undefined;
  const out: Unlock = { to: p.to === "keep" ? "keep" : "season" };
  if (p.to === "game" && typeof p.g === "string" && SLUG.test(p.g)) {
    out.to = "game"; out.g = p.g; out.p = p.p === "highlights" ? "highlights" : "report";
  }
  if (isB64(p.t)) out.t = p.t;
  if (c && isB64(c.a) && isB64(c.e) && isB64(c.c)) out.c = { a: c.a, e: c.e, c: c.c };
  if (k && isB64(k.a) && isB64(k.e) && isB64(k.r)) {
    out.k = { a: k.a, e: k.e, r: k.r };
    if (typeof k.u === "string" && /^[0-9a-f]{64}$/.test(k.u)) out.k.u = k.u;
  }
  return out.t || out.c || out.k ? out : null;
}

// Where each part is kept; the same keys and shapes the password forms write (lib/crypto.ts keyStore,
// notes.tsx, keeper.tsx), so the rest of the site can't tell the difference.
export const STORES = { film: "dfc-film-key", notes: "dfc-notes-keys", keeper: "dfc-keeper-keys" } as const;

/** Stores the keys, remembered on this device as "keep me signed in" would. */
export function applyUnlock(u: Unlock, storage: Pick<Storage, "setItem"> = localStorage) {
  if (u.t) storage.setItem(STORES.film, u.t.replace(/-/g, "+").replace(/_/g, "/"));
  if (u.c) storage.setItem(STORES.notes, JSON.stringify({ a: u.c.a, e: u.c.e, c: u.c.c }));
  if (u.k) storage.setItem(STORES.keeper, JSON.stringify({ a: u.k.a, e: u.k.e, r: u.k.r, ...(u.k.u ? { u: u.k.u } : {}) }));
}

/** Run once before the app starts: takes the keys out of the address, if the manager sent any. */
export function takeUnlock() {
  const u = readUnlock(location.hash);
  if (!u) return;
  try { applyUnlock(u); applyUnlock(u, sessionStorage); } catch { /* storage blocked: the password forms still work */ }
  history.replaceState(null, "", `${location.pathname}${location.search}#${landing(u)}`);
}

/** The page an unlock lands on. */
export function landing(u: Unlock) {
  return u.to === "game" && u.g ? `/game/${u.g}/${u.p ?? "report"}` : `/${u.to}`;
}
