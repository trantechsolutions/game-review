import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createHashRouter, Link, NavLink, Navigate, Outlet, RouterProvider, useLocation, useParams } from "react-router-dom";
import { GameHeader } from "./components/GameHeader";
import { CoachLogin, NotesDrawer } from "./components/Notes";
import { useI18n, type Key } from "./i18n";
import { NotesProvider, useNotes } from "./notes";
import { Coaches } from "./pages/Coaches";
import { GameList } from "./pages/GameList";
import { Highlights } from "./pages/Highlights";
import { History } from "./pages/History";
import { KeepApp } from "./pages/Keep";
import { MatchReport } from "./pages/MatchReport";
import { PlayByPlay } from "./pages/PlayByPlay";
import { Player, Players } from "./pages/Players";
import { Season } from "./pages/Season";
import { UnitReview } from "./pages/UnitReview";
import { useCoaches } from "./pages/Coaches";
import type { PublicGame } from "./schema";
import { BadPassword, MissingData, SiteContext, useSite, useUnlock } from "./site";

// A game's pages, in tab order: the summary first, the deepest reads last. A game opens on the first.
const PAGES = {
  report: { key: "matchReport", C: MatchReport },
  highlights: { key: "highlights", C: Highlights },
  "play-by-play": { key: "playByPlay", C: PlayByPlay },
  units: { key: "unitReview", C: UnitReview },
  coaches: { key: "coachesBreakdown", C: Coaches },
} as const;
type PageId = keyof typeof PAGES;

function LangToggle({ className = "btn-line" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className={className} lang={lang === "en" ? "es" : "en"} aria-label={t("languageLabel")}
      onClick={() => setLang(lang === "en" ? "es" : "en")}>{t("language")}</button>
  );
}

function AppBar() {
  const { t } = useI18n();
  const { lock, manifest } = useSite();
  const notes = useNotes();
  const { slug, page } = useParams();
  const nav = useRef<HTMLElement>(null);
  // On narrow screens the links scroll sideways; keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [slug, page]);
  // The site's own pages only; a game's pages are tabs under its header. Inside a game, the library is "here".
  return (
    <div className="appbar">
      <nav ref={nav} aria-label={t("allGames")}>
        <Link className="home" to="/season">{manifest.us} <span>film</span></Link>
        <NavLink to="/season">{t("seasonOverview")}</NavLink>
        <NavLink to="/library" aria-current={slug ? "page" : undefined} className={({ isActive }) => (isActive || slug ? "active" : "")}>{t("library")}</NavLink>
        {manifest.ollieFile ? <NavLink to="/history">{t("ollieHistory")}</NavLink> : null}
        {notes.signedIn ? <NavLink to="/players">{t("players")}</NavLink> : null}
      </nav>
      <div className="tools">
        <LangToggle />
        {notes.signedIn
          ? <button type="button" className="btn-line on" onClick={notes.signOut}>{t("coach")} · {t("signOut")}</button>
          : <button type="button" className="btn-line" onClick={() => notes.setLoginOpen(true)}>{t("coach")}</button>}
        <button type="button" className="btn-line" onClick={lock}>{t("lock")}</button>
      </div>
    </div>
  );
}

function Shell() {
  const { pathname, hash } = useLocation();
  // New page: start at the top, unless it's an in-page link.
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname, hash]);
  return <><AppBar /><Outlet /><CoachLogin /></>;
}

function Status({ children }: { children: ReactNode }) {
  return <div className="status wrap" role="status">{children}</div>;
}

function GamePage() {
  const { slug = "", page = "" } = useParams();
  const { loadGame, manifest } = useSite();
  const { t, tx, ev } = useI18n();
  const notes = useNotes();
  const coaches = useCoaches(slug); // for note labels on coaches' sections
  const [state, setState] = useState<{ slug: string; game?: PublicGame; error?: unknown }>({ slug });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ slug });
    loadGame(slug).then(game => live && setState({ slug, game }), error => live && setState({ slug, error }));
    return () => { live = false; };
  }, [slug, loadGame, attempt]);

  const entry = manifest.games.find(g => g.slug === slug);
  useEffect(() => {
    if (entry) document.title = `${manifest.us} ${entry.us}–${entry.them} ${entry.opponent} · ${t(PAGES[page as PageId]?.key ?? "appTitle")}`;
  }, [entry, page, t]);

  if (!entry) return <Status><p>{t("notFound")}</p><Link className="btn-line" to="/library">{t("allGames")}</Link></Status>;
  if (!(page in PAGES)) return <Navigate to={`/game/${slug}/report`} replace />;
  if (state.error) return <Status><p>{t("loadFailed")}</p><button className="btn-line" onClick={() => setAttempt(a => a + 1)}>{t("retry")}</button></Status>;
  if (!state.game || state.slug !== slug) return <Status><p>{t("loading")}</p></Status>;

  const g = state.game;
  const { C } = PAGES[page as PageId];
  const labelFor = (anchor: string): string => {
    if (anchor === "game" || anchor === "*") return t("gameNote");
    if (anchor.startsWith("event:")) {
      const e = g.events.find(x => x.id === anchor.slice(6));
      return e ? `${e.h === 1 ? t("half1") : t("half2")} ${e.c} · ${ev(e.y)}` : anchor;
    }
    if (anchor.startsWith("clip:")) {
      const c = g.highlights.clips.find(x => x.id === anchor.slice(5));
      return c ? tx(c.label) : anchor;
    }
    const [pg, id] = anchor.slice("section:".length).split("/");
    const R = g.report;
    const map: Record<string, string> = {
      "report/story": tx(R.story.title), "report/first-half": tx(R.halves[0].title), "report/second-half": tx(R.halves[1].title),
      "report/numbers": tx(R.numbers.title), "report/takeaways": tx(R.takeaways.title), "report/clips": tx(R.clips.title),
    };
    const C2 = coaches.coaches;
    if (C2) {
      Object.assign(map, {
        "coaches/priorities": tx(C2.priorities.title), "coaches/thirds": tx(C2.thirds.title), "coaches/units": tx(C2.units.title),
        "coaches/plan": tx(C2.plan.title), "coaches/clips": tx(C2.clips.title),
      });
      C2.thirds.blocks.forEach((b, i) => { map[`coaches/third-${i + 1}`] = tx(b.name); });
      C2.units.items.forEach((u, i) => { map[`coaches/unit-${i + 1}`] = tx(u.name); });
    }
    for (const u of ["defense", "midfield", "attack"] as const) map[`units/${u}`] = t(`unit_${u}`);
    return map[`${pg}/${id}`] ?? anchor;
  };

  const tabs = (Object.keys(PAGES) as PageId[]).filter(p => p !== "coaches" || notes.signedIn).map(p => [p, PAGES[p].key] as [string, Key]);
  return (
    <>
      <GameHeader g={g} page={page} tabs={tabs} />
      <C game={g} />
      {notes.signedIn ? (
        <button type="button" className="notes-fab" onClick={() => notes.openDrawer(g.slug, "*", t("notes"))}>{t("notes")}</button>
      ) : null}
      <NotesDrawer slug={g.slug} labelFor={labelFor} />
    </>
  );
}

const router = createHashRouter([{
  element: <Shell />,
  children: [
    // Season overview is the home page; the game list is the library.
    { path: "/", element: <Navigate to="/season" replace /> },
    { path: "/library", element: <GameList /> },
    { path: "/season", element: <Season /> },
    { path: "/history", element: <History /> },
    { path: "/players", element: <Players /> },
    { path: "/player/:id", element: <Player /> },
    { path: "/keep/*", element: null }, // App swaps to scorekeeper mode on this hash
    { path: "/game/:slug", element: <GamePage /> },
    { path: "/game/:slug/:page", element: <GamePage /> },
    { path: "*", element: <Navigate to="/season" replace /> },
  ],
}]);

function Gate({ submit }: { submit: (pw: string, remember: boolean) => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true); setMsg(t("checking"));
    try { await submit(String(f.get("pw")).trim(), f.get("remember") === "on"); }
    catch (err) { setMsg(err instanceof BadPassword ? t("badPassword") : err instanceof MissingData ? t("missingData") : t("loadFailed")); setBusy(false); }
  }
  return (
    <main className="gate">
      <form onSubmit={onSubmit}>
        <p className="eyebrow">{t("teamOnly")}</p>
        <h1>{t("appTitle").split(" ")[0]} <span>{t("appTitle").split(" ").slice(1).join(" ")}</span></h1>
        <div className="field">
          <label htmlFor="pw">{t("teamPassword")}</label>
          <input id="pw" name="pw" type={show ? "text" : "password"} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} required autoFocus />
        </div>
        <label className="check"><input id="remember" name="remember" type="checkbox" /> {t("keepSignedIn")}</label>
        <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> {t("showPassword")}</label>
        <button type="submit" className="btn-solid" disabled={busy}>{t("open")}</button>
        <p className="msg" role="alert">{msg}</p>
        <LangToggle className="btn-line lang" />
        <a className="btn-line lang" href="#/keep">{t("scorekeeper")}</a>
      </form>
    </main>
  );
}

// Scorekeeper mode has its own password and opens without the team password.
const isKeep = () => /^#\/keep(\/|$)/.test(location.hash);

export function App() {
  const [keep, setKeep] = useState(isKeep);
  useEffect(() => {
    const on = () => setKeep(isKeep());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return keep ? <KeepApp /> : <FilmApp />;
}

function FilmApp() {
  const { state, submit, retry } = useUnlock();
  const { t } = useI18n();
  if (state.phase === "checking") return <Status><p>{t("loading")}</p></Status>;
  if (state.phase === "locked") return <Gate submit={submit} />;
  if (state.phase === "error") return <Status><p>{t("loadFailed")}</p><button className="btn-line" onClick={retry}>{t("retry")}</button></Status>;
  return (
    <SiteContext keyObj={state.key} manifest={state.manifest}>
      <NotesProvider>
        <RouterProvider router={router} />
      </NotesProvider>
    </SiteContext>
  );
}
