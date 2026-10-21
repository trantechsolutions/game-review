import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { T } from "../components/RichText";
import { formatDate, useI18n } from "../i18n";
import { fmtStat, PLAYER_STATS, resultOf, seasonOf, summarize, TEAM_STATS, type WDLRecord as WDL } from "../lib/ollie";
import { useNotes } from "../notes";
import type { OllieGame, OllieHistory, OlliePlayers } from "../schema";
import { useSite } from "../site";

const LETTER_ES = { W: "G", D: "E", L: "P" } as const;

/** Game history from Ollie Sports: every game Ollie recorded that the library doesn't already break down. */
export function History() {
  const { manifest, loadOllie } = useSite();
  const { t } = useI18n();
  const [state, setState] = useState<{ h?: OllieHistory | null; error?: unknown }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { document.title = `${manifest.us} · ${t("ollieHistory")}`; }, [manifest.us, t]);
  useEffect(() => {
    let live = true;
    loadOllie().then(h => live && setState({ h }), error => live && setState({ error }));
    return () => { live = false; };
  }, [loadOllie, attempt]);
  if (state.error) return <div className="status wrap" role="status"><p>{t("loadFailed")}</p><button className="btn-line" onClick={() => setAttempt(a => a + 1)}>{t("retry")}</button></div>;
  if (state.h === undefined) return <div className="status wrap" role="status"><p>{t("loading")}</p></div>;
  if (!state.h) return <div className="status wrap" role="status"><p>{t("ollieNone")}</p></div>;
  return <HistoryView h={state.h} />;
}

function HistoryView({ h }: { h: OllieHistory }) {
  const { manifest, loadOlliePlayers } = useSite();
  const { contentKey } = useNotes();
  const US = manifest.us;
  const { t, lang, locale } = useI18n();
  const [season, setSeason] = useState("all");
  const [search, setSearch] = useState("");
  const [withLibrary, setWithLibrary] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [players, setPlayers] = useState<OlliePlayers | null>(null);
  useEffect(() => {
    if (!contentKey) { setPlayers(null); return; }
    let live = true;
    loadOlliePlayers(contentKey).then(p => live && setPlayers(p), () => live && setPlayers(null));
    return () => { live = false; };
  }, [contentKey, loadOlliePlayers]);

  const seasons = useMemo(() => [...new Set(h.games.map(g => seasonOf(g.date)))].sort().reverse(), [h.games]);
  const inLibrary = h.games.filter(g => g.inApp).length;
  const q = search.trim().toLowerCase();
  const shown = h.games.filter(g => (withLibrary || !g.inApp) && (season === "all" || seasonOf(g.date) === season) && (!q || g.opponent.toLowerCase().includes(q)));
  const rec = useMemo(() => summarize(shown), [shown]);
  const num = (x: number) => x.toLocaleString(locale, { maximumFractionDigits: 1 });
  const winPct = (r: WDL) => (r.n ? `${Math.round((r.W / r.n) * 100)}%` : "—");
  const gd = (r: WDL) => `${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}`;
  const avg = (p: [number, number] | null, pct = false) => (p ? (pct ? `${Math.round(p[0] * 100)}% – ${Math.round(p[1] * 100)}%` : `${num(p[0])} – ${num(p[1])}`) : "—");
  const filtered = season !== "all" || !!q || withLibrary;
  const Res = ({ g }: { g: OllieGame }) => { const r = resultOf(g.us, g.them); return <i className={`res-chip ${r}`}>{lang === "es" ? LETTER_ES[r] : r}</i>; };
  const pair = (g: OllieGame, key: string, kind?: "pct") => (g.stats ? `${fmtStat(g.stats.own[key] ?? 0, kind, locale)} – ${fmtStat(g.stats.opp[key] ?? 0, kind, locale)}` : "—");

  return (
    <div className="pg-season pg-history">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow"><T t={manifest.team} /> · {t("ollieEyebrow")}</span>
          <h1>{lang === "es" ? <>Historial de <span>partidos</span></> : <>Game <span>history</span></>}</h1>
          <div className="record">
            <span><b>{rec.n}</b> {t("gamesShort")}</span>
            <span>{t("record")} <b>{rec.W}-{rec.D}-{rec.L}</b></span>
            <span>{t("goalsFor")} <b>{rec.gf}–{rec.ga}</b> ({gd(rec)})</span>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section className="sec">
          <div className="sec-head">
            <span className="eyebrow">{t("ollieListEyebrow")}</span><h2>{t("ollieGames")}</h2>
            <p className="sub">{t("ollieSub", { n: inLibrary })}</p>
          </div>
          <div className="hist-tools">
            <label>{t("ollieSeason")}
              <select value={season} onChange={e => setSeason(e.target.value)}>
                <option value="all">{t("ollieAllSeasons")}</option>
                {seasons.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>{t("ollieOpponent")}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("ollieSearch")} /></label>
            <label className="check"><input type="checkbox" checked={withLibrary} onChange={e => setWithLibrary(e.target.checked)} /> {t("ollieWithLibrary", { n: inLibrary })}</label>
          </div>
          <section className="hist-record" aria-live="polite" aria-label={t("ollieRecord")}>
            <div className="hist-record-head">
              <span className="eyebrow">{t("ollieRecord")}</span>
              <span className="muted">{filtered ? [season !== "all" ? season : t("ollieAllSeasons"), q ? `“${search.trim()}”` : null, withLibrary ? t("ollieWithLibraryShort") : null].filter(Boolean).join(" · ") : t("ollieAllNew")}</span>
            </div>
            <div className="hist-tiles">
              <div className="ms"><span className="eyebrow">{t("record")}</span><span className="vals"><b>{rec.W}-{rec.D}-{rec.L}</b></span><span className="muted">{t("ollieWinPct", { pct: winPct(rec), n: rec.n })}</span></div>
              <div className="ms"><span className="eyebrow">{t("goalsFor")}</span><span className="vals"><b className="dfc-t">{rec.gf}</b>–<b className="opp-t">{rec.ga}</b></span><span className="muted">{gd(rec)} · {t("cleanSheets")} {rec.cleanSheets}</span></div>
              <div className="ms"><span className="eyebrow">{t("ollieAvgPossession")}</span><span className="vals">{avg(rec.avg.possession, true)}</span><span className="muted">{t("perGame")}</span></div>
              <div className="ms"><span className="eyebrow">{t("ollieAvgShots")}</span><span className="vals">{avg(rec.avg.shots)}</span><span className="muted">{t("ollieOnGoal")} {avg(rec.avg.onGoal)}</span></div>
            </div>
            <div className="table-wrap"><table className="nums hist-venue">
              <thead><tr><th /><th>{t("ollieGamesCol")}</th><th>{t("record")}</th><th>{t("ollieWin")}</th><th>{t("goalsFor")}</th></tr></thead>
              <tbody>
                {(["home", "away", "unknown"] as const).filter(v => rec.venue[v].n).map(v => {
                  const r = rec.venue[v];
                  return <tr key={v}><th scope="row">{v === "home" ? t("homeShort") : v === "away" ? t("awayShort") : t("ollieVenueUnknown")}</th><td>{r.n}</td><td>{r.W}-{r.D}-{r.L}</td><td>{winPct(r)}</td><td>{r.gf}–{r.ga} ({gd(r)})</td></tr>;
                })}
              </tbody>
            </table></div>
          </section>
          <div className="table-wrap">
            <table className="nums hist">
              <thead><tr>
                <th>{t("colDate")}</th><th>{t("ollieOpponent")}</th><th>{t("colScore")}</th>
                <th>{t("colPossession")}</th><th>{t("colShots")}</th><th>{t("ollieOnGoal")}</th><th aria-label={t("ollieDetails")} />
              </tr></thead>
              <tbody>
                {shown.map(g => (
                  <Fragment key={g.id}>
                    <tr className={`hist-row${open === g.id ? " open" : ""}`} onClick={() => setOpen(open === g.id ? null : g.id)}>
                      <td className="mono">{formatDate(g.date, locale, "short")} {g.date.slice(0, 4)}</td>
                      <th scope="row">{g.opponent}{g.home == null ? null : <span className="muted"> · {g.home ? t("homeShort") : t("awayShort")}</span>}</th>
                      <td><Res g={g} /> {g.us}–{g.them}</td>
                      <td>{pair(g, "tPossessionPerc", "pct")}</td>
                      <td>{pair(g, "tShots")}</td>
                      <td>{pair(g, "tShotsOnTarget")}</td>
                      <td><button type="button" className="btn-line hist-open" aria-expanded={open === g.id} onClick={e => { e.stopPropagation(); setOpen(open === g.id ? null : g.id); }}>{open === g.id ? "−" : "+"}</button></td>
                    </tr>
                    {open === g.id ? <tr className="hist-detail"><td colSpan={7}><Detail g={g} us={US} players={players?.games[g.id]} coach={!!contentKey} /></td></tr> : null}
                  </Fragment>
                ))}
                {!shown.length ? <tr><td colSpan={7} className="muted">{t("ollieEmpty")}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="sub hist-foot">{t("ollieFooter", { when: new Date(h.pulledAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })}</p>
        </section>
      </main>
    </div>
  );
}

function Detail({ g, us, players, coach }: { g: OllieGame; us: string; players?: OlliePlayers["games"][string]; coach: boolean }) {
  const { t, tx, locale } = useI18n();
  const [part, setPart] = useState<"stats" | "first" | "second">("stats");
  const pick = part === "stats" ? g.stats : g.halves[part];
  const rows = pick ? TEAM_STATS.filter(([k]) => (pick.own[k] ?? 0) || (pick.opp[k] ?? 0) || k === "tGoals") : [];
  const cols = players ? PLAYER_STATS.filter(([k]) => players.some(p => p.stats[k])) : [];
  return (
    <div className="hist-body">
      {g.inApp ? <p><Link className="btn-line" to={`/game/${g.inApp}/report`}>{t("ollieOpenLibrary")}</Link></p> : null}
      <div className="hist-tabs" role="tablist">
        {(["stats", "first", "second"] as const).map(p => (
          <button key={p} type="button" role="tab" aria-selected={part === p} className={`btn-line${part === p ? " on" : ""}`} disabled={p !== "stats" && !g.halves[p]} onClick={() => setPart(p)}>
            {p === "stats" ? t("ollieWhole") : p === "first" ? t("half1") : t("half2")}
          </button>
        ))}
        {g.statMode ? <span className="muted">{t("ollieMode", { mode: g.statMode })}</span> : null}
      </div>
      {pick ? (
        <table className="nums hist-stats">
          <thead><tr><th className="dfc-t">{us}</th><th /><th className="opp-t">{g.opponent}</th></tr></thead>
          <tbody>{rows.map(([k, label, kind]) => (
            <tr key={k}><td className="dfc-t">{fmtStat(pick.own[k] ?? 0, kind, locale)}</td><th scope="row">{tx(label)}</th><td className="opp-t">{fmtStat(pick.opp[k] ?? 0, kind, locale)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="muted">{t("ollieNoStats")}</p>}
      {part === "stats" ? (
        players?.length ? (
          <div className="table-wrap">
            <table className="nums hist-players">
              <thead><tr><th>{t("players")}</th>{cols.map(([k, label]) => <th key={k}>{tx(label)}</th>)}</tr></thead>
              <tbody>
                {[...players].sort((a, b) => (b.stats.pPlayingTimeMS ?? 0) - (a.stats.pPlayingTimeMS ?? 0)).map(p => (
                  <tr key={p.name}><th scope="row">{p.number ? `#${p.number} ` : ""}{p.name}</th>{cols.map(([k, , kind]) => <td key={k}>{p.stats[k] ? fmtStat(p.stats[k], kind, locale) : ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !coach ? <p className="muted">{t("olliePlayersLocked")}</p> : null
      ) : null}
    </div>
  );
}
