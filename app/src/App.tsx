import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createHashRouter, Link, NavLink, Navigate, Outlet, RouterProvider, useLocation, useParams } from "react-router-dom";
import { CoachLogin, NotesDrawer } from "./components/Notes";
import { useI18n } from "./i18n";
import { NotesProvider, useNotes } from "./notes";
import { Coaches } from "./pages/Coaches";
import { GameList } from "./pages/GameList";
import { Highlights } from "./pages/Highlights";
import { MatchReport } from "./pages/MatchReport";
import { PlayByPlay } from "./pages/PlayByPlay";
import type { Game } from "./schema";
import { BadPassword, MissingData, SiteContext, useSite, useUnlock } from "./site";

const PAGES = {
  "play-by-play": { key: "playByPlay", C: PlayByPlay },
  coaches: { key: "coachesBreakdown", C: Coaches },
  highlights: { key: "highlights", C: Highlights },
  report: { key: "matchReport", C: MatchReport },
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
  // On narrow screens the page links scroll sideways; keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [slug, page]);
  return (
    <div className="appbar">
      <nav ref={nav} aria-label={t("allGames")}>
        <Link className="home" to="/">{manifest.us} <span>film</span></Link>
        {slug ? (Object.keys(PAGES) as PageId[]).map(p => (
          <NavLink key={p} to={`/game/${slug}/${p}`}>{t(PAGES[p].key)}</NavLink>
        )) : null}
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
  const [state, setState] = useState<{ slug: string; game?: Game; error?: unknown }>({ slug });
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

  if (!entry) return <Status><p>{t("notFound")}</p><Link className="btn-line" to="/">{t("allGames")}</Link></Status>;
  if (!(page in PAGES)) return <Navigate to={`/game/${slug}/play-by-play`} replace />;
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
    const C2 = g.coaches, R = g.report;
    const map: Record<string, string> = {
      "report/story": tx(R.story.title), "report/first-half": tx(R.halves[0].title), "report/second-half": tx(R.halves[1].title),
      "report/numbers": tx(R.numbers.title), "report/takeaways": tx(R.takeaways.title), "report/clips": tx(R.clips.title),
      "coaches/priorities": tx(C2.priorities.title), "coaches/thirds": tx(C2.thirds.title), "coaches/units": tx(C2.units.title),
      "coaches/plan": tx(C2.plan.title), "coaches/clips": tx(C2.clips.title),
    };
    C2.thirds.blocks.forEach((b, i) => { map[`coaches/third-${i + 1}`] = tx(b.name); });
    C2.units.items.forEach((u, i) => { map[`coaches/unit-${i + 1}`] = tx(u.name); });
    return map[`${pg}/${id}`] ?? anchor;
  };

  return (
    <>
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
    { path: "/", element: <GameList /> },
    { path: "/game/:slug", element: <GamePage /> },
    { path: "/game/:slug/:page", element: <GamePage /> },
    { path: "*", element: <Navigate to="/" replace /> },
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
      </form>
    </main>
  );
}

export function App() {
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
