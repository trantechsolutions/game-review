import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { T } from "../components/RichText";
import { formatDate, useI18n } from "../i18n";
import { RECENT, season, themes, WINDOWS, type GameLine, type Result, type Theme } from "../lib/season";
import { useNotes } from "../notes";
import type { PublicGame } from "../schema";
import { useSite } from "../site";
import { Toc, useAllGames } from "./shared";

const LETTER_ES = { W: "G", D: "E", L: "P" } as const;

/** Season overview: every game opened with the team password and summed up. Positions only, no names. */
export function Season() {
  const { manifest } = useSite();
  const { t } = useI18n();
  const state = useAllGames();

  useEffect(() => { document.title = `${manifest.us} · ${t("season")}`; }, [manifest.us, t]);

  if (state.error) return <div className="status wrap" role="status"><p>{t("loadFailed")}</p><button className="btn-line" onClick={state.retry}>{t("retry")}</button></div>;
  if (!state.games) return <div className="status wrap" role="status"><p>{t("loading")}</p></div>;
  return <SeasonView games={state.games} />;
}

function Res({ r }: { r: Result }) {
  const { lang } = useI18n();
  return <i className={`res-chip ${r}`}>{lang === "es" ? LETTER_ES[r] : r}</i>;
}

function SeasonView({ games }: { games: PublicGame[] }) {
  const { manifest } = useSite();
  const US = manifest.us;
  const { t, lang, locale } = useI18n();
  const s = useMemo(() => season(games), [games]);
  const n = s.lines.length;
  const num = (x: number) => x.toLocaleString(locale, { maximumFractionDigits: 1 });
  const pair = (p: [number, number] | null, unit = "") => (p ? `${num(p[0])}${unit}–${num(p[1])}${unit}` : "—");
  const day = (iso: string) => formatDate(iso, locale, "short");
  const gd = s.record.gf - s.record.ga;
  const maxGoals = Math.max(1, ...s.lines.flatMap(l => [l.us, l.them]));
  // Bars top out at 70% so the count above (or below) the tallest one stays inside its half's box.
  const maxWindow = Math.max(1, ...s.timing.flat().flat()) / 0.7;
  const halfTotals = s.timing.map(h => h.reduce((a, w) => [a[0] + w[0], a[1] + w[1]], [0, 0]));

  return (
    <div className="pg-season">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow"><T t={manifest.team} /></span>
          <h1>{lang === "es" ? <>Resumen de la <span>temporada</span></> : <>Season <span>overview</span></>}</h1>
          <div className="record">
            <span><b>{n}</b> {t("gamesReviewed")}</span>
            <span>{t("record")} <b>{s.record.W}-{s.record.D}-{s.record.L}</b></span>
            <span>{t("goalsFor")} <b>{s.record.gf}–{s.record.ga}</b> ({gd > 0 ? "+" : ""}{gd})</span>
            <span>{t("cleanSheets")} <b>{s.record.cleanSheets}</b></span>
          </div>
          <div className="form" aria-label={t("formLabel")}>
            <span className="eyebrow">{t("form")}</span>
            {s.lines.map(l => <Res key={l.slug} r={l.result} />)}
          </div>
        </div>
      </header>

      <main className="wrap">
        <Toc items={[["results", t("results")], ["timing", t("goalTiming")], ["numbers", t("numbers")], ["themes", t("themes")],
          ...(s.repeats.length ? [["repeats", t("headToHead")] as [string, string]] : [])]} />

        <section className="sec" id="results">
          <div className="sec-head"><span className="eyebrow">{t("resultsEyebrow")}</span><h2>{t("results")}</h2></div>
          <ol className="results">
            {s.lines.map(l => <ResultRow key={l.slug} l={l} max={maxGoals} day={day(l.date)} />)}
          </ol>
          <div className="ht-split">
            {(["ahead", "level", "behind"] as const).map(k => {
              const r = s.fromHalfTime[k], total = r.W + r.D + r.L;
              return (
                <div key={k} className="ms">
                  <span className="eyebrow">{t(`ht_${k}`)}</span>
                  <span className="vals">{total}<span className="sep">{t("gamesShort")}</span></span>
                  <span className="wdl">{total ? <>{r.W}<Res r="W" /> {r.D}<Res r="D" /> {r.L}<Res r="L" /></> : "—"}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="sec" id="timing">
          <div className="sec-head">
            <span className="eyebrow">{t("goalTimingEyebrow")}</span><h2>{t("goalTiming")}</h2>
            <p className="sub">{t("goalTimingSub", { us: US })}</p>
          </div>
          <div className="timing" role="img" aria-label={t("goalTimingLabel", { us: US, h1for: halfTotals[0][0], h1against: halfTotals[0][1], h2for: halfTotals[1][0], h2against: halfTotals[1][1] })}>
            {s.timing.map((half, h) => (
              <div key={h} className="t-half">
                <span className="t-title">{h === 0 ? t("half1") : t("half2")} <b className="dfc-t">{halfTotals[h][0]}</b>–<b className="opp-t">{halfTotals[h][1]}</b></span>
                <div className="t-cols">
                  {half.map(([f, a], w) => (
                    <div key={w} className="t-col">
                      <span className="t-bar up" style={{ height: `${(f / maxWindow) * 100}%` }}><b>{f || ""}</b></span>
                      <span className="t-axis">{WINDOWS[w][1] === null ? `${WINDOWS[w][0]}'+` : `${WINDOWS[w][0]}–${WINDOWS[w][1]}'`}</span>
                      <span className="t-bar down" style={{ height: `${(a / maxWindow) * 100}%` }}><b>{a || ""}</b></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="legend">
            <span><i className="sw" style={{ background: "var(--dfc)" }}></i>{t("scoredBy", { team: US })}</span>
            <span><i className="sw" style={{ background: "var(--opp)" }}></i>{t("conceded")}</span>
          </div>
        </section>

        <section className="sec" id="numbers">
          <div className="sec-head">
            <span className="eyebrow">{t("numbersEyebrow")}</span><h2>{t("numbers")}</h2>
            <p className="sub">{t("numbersSub", { us: US })}</p>
          </div>
          <div className="table-wrap">
            <table className="nums">
              <thead><tr><th>{t("colGameShort")}</th><th>{t("colScore")}</th><th>{t("colShots")}</th><th>{t("colOnTarget")}</th><th>{t("colPossession")}</th></tr></thead>
              <tbody>
                {s.lines.map(l => (
                  <tr key={l.slug}>
                    <th scope="row"><Link to={`/game/${l.slug}/report`}>{day(l.date)} · {l.opponent}</Link></th>
                    <td><Res r={l.result} /> {l.us}–{l.them}</td>
                    <td>{pair(l.shots)}</td><td>{pair(l.onTarget)}</td><td>{pair(l.possession, "%")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t("perGame")}</th>
                  <td>{num(s.record.gf / Math.max(n, 1))}–{num(s.record.ga / Math.max(n, 1))}</td>
                  <td>{pair(s.avg.shots)}</td><td>{pair(s.avg.onTarget)}</td><td>{pair(s.avg.possession, "%")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <Themes games={games} />

        {s.repeats.length ? (
          <section className="sec" id="repeats">
            <div className="sec-head"><span className="eyebrow">{t("headToHeadEyebrow")}</span><h2>{t("headToHead")}</h2></div>
            <div className="repeats">
              {s.repeats.map(r => {
                const f = r.lines.reduce((a, l) => a + l.us, 0), ag = r.lines.reduce((a, l) => a + l.them, 0);
                return (
                  <div key={r.opponent} className="rep-card">
                    <h3><span className="vs">{t("vs")}</span>{r.opponent}</h3>
                    <ul>
                      {r.lines.map(l => (
                        <li key={l.slug}><Link to={`/game/${l.slug}/report`}>{day(l.date)}</Link><span><Res r={l.result} /> {l.us}–{l.them}</span><span>{pair(l.shots)} {t("colShots").toLowerCase()}</span></li>
                      ))}
                    </ul>
                    <p className="tag">{t("goalsFor")} {f}–{ag}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <footer className="foot"><p>{t("seasonFooter")}</p></footer>
      </main>
    </div>
  );
}

/** Recurring themes from the coaches' breakdowns. Coach password only, like the breakdowns themselves. */
function Themes({ games }: { games: PublicGame[] }) {
  const { t } = useI18n();
  const { contentKey, setLoginOpen } = useNotes();
  const { loadCoaches } = useSite();
  const [state, setState] = useState<{ list?: Theme[]; error?: unknown }>({});

  useEffect(() => {
    if (!contentKey) { setState({}); return; }
    let live = true;
    setState({});
    Promise.all(games.map(g => loadCoaches(g.slug, contentKey).then(coaches => ({ date: g.date, coaches }))))
      .then(cs => live && setState({ list: themes(cs) }), error => live && setState({ error }));
    return () => { live = false; };
  }, [games, contentKey, loadCoaches]);

  const n = games.length, recent = Math.min(RECENT, n);
  return (
    <section className="sec" id="themes">
      <div className="sec-head">
        <span className="eyebrow">{t("themesEyebrow")}</span><h2>{t("themes")}</h2>
        {contentKey ? <p className="sub">{t("themesSub", { n: recent })}</p> : null}
      </div>
      {!contentKey ? (
        <div className="themes-locked">
          <p className="sub">{t("themesLocked")}</p>
          <button type="button" className="btn-line" onClick={() => setLoginOpen(true)}>{t("coachSignIn")}</button>
        </div>
      ) : state.error ? <p className="sub">{t("loadFailed")}</p>
        : !state.list ? <p className="sub">{t("loading")}</p> : (
        <ul className="themes">
          {state.list.map(a => (
            <li key={a.area}>
              <span className="th-name">{t(`area_${a.area}`)}</span>
              <span className="th-track" aria-hidden="true">
                <span className="th-fill" style={{ width: `${(a.games / n) * 100}%` }}></span>
                <span className="th-high" style={{ width: `${(a.highGames / n) * 100}%` }}></span>
              </span>
              <span className="th-count">{t("highInGames", { x: a.highGames, n })} · {t("lastN", { n: recent, x: a.recentHigh })}</span>
              <span className="th-units">
                <span>{a.fixes.high + a.fixes.med + a.fixes.low === 1 ? t("fixesOne") : t("fixesCount", { x: a.fixes.high + a.fixes.med + a.fixes.low })}</span>
                {(["defensive", "middle", "attacking"] as const).map((k, i) => a.thirds[i] ? <span key={k}>{t(`third_${k}`)} {a.thirds[i]}</span> : null)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultRow({ l, max, day }: { l: GameLine; max: number; day: string }) {
  const { t } = useI18n();
  const where = l.home === null ? "" : l.home ? t("homeShort") : t("awayShort");
  return (
    <li className="r-row">
      <span className="r-date">{day}{where ? ` · ${where}` : ""}</span>
      <Link className="r-opp" to={`/game/${l.slug}/report`}><span className="vs">{t("vs")}</span>{l.opponent}</Link>
      <span className="r-bars" aria-hidden="true">
        <span className="bar-track l"><span className="bar-fill d" style={{ width: `${(l.us / max) * 100}%` }}></span></span>
        <span className="bar-track"><span className="bar-fill o" style={{ width: `${(l.them / max) * 100}%` }}></span></span>
      </span>
      <span className="r-score"><Res r={l.result} /> {l.us}–{l.them} <span className="r-ht">{t("ht")} {l.htUs}–{l.htThem}</span></span>
    </li>
  );
}
