import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Md, T } from "../components/RichText";
import { formatDate, useI18n } from "../i18n";
import { minutes } from "../lib/lineup";
import { playerSeasons, type PlayerGame, type PlayerSeason } from "../lib/players";
import { playerLabel } from "../lib/positions";
import { useNotes } from "../notes";
import type { PublicGame, Roster } from "../schema";
import { useSite } from "../site";
import { playerId, useLineups, useNamer, useRoster } from "../squad";
import { eventLabel, useAllGames } from "./shared";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Names stay behind the coach password: the squad pages show nothing until the coach area is unlocked. */
function useSquad() {
  const { contentKey } = useNotes();
  const games = useAllGames();
  const roster = useRoster();
  const lineups = useLineups();
  const seasons = useMemo(
    () => (games.games && roster ? playerSeasons(roster.players.map(p => p.name), games.games, lineups) : null),
    [games.games, roster, lineups]);
  return { locked: !contentKey, games, roster, seasons };
}

function Locked() {
  const { t } = useI18n();
  const { setLoginOpen } = useNotes();
  return (
    <div className="status wrap locked">
      <span className="eyebrow">{t("players")}</span>
      <h1>{t("coachesOnly")}</h1>
      <p className="sub">{t("playersLocked")}</p>
      <button type="button" className="btn-solid" onClick={() => setLoginOpen(true)}>{t("signIn")}</button>
    </div>
  );
}

function Wait({ games }: { games: ReturnType<typeof useAllGames> }) {
  const { t } = useI18n();
  return games.error
    ? <div className="status wrap" role="status"><p>{t("loadFailed")}</p><button className="btn-line" onClick={games.retry}>{t("retry")}</button></div>
    : <div className="status wrap" role="status"><p>{t("loading")}</p></div>;
}

export function Players() {
  const { manifest } = useSite();
  const { t, locale } = useI18n();
  const { locked, games, roster, seasons } = useSquad();
  useEffect(() => { document.title = `${manifest.us} · ${t("players")}`; }, [manifest.us, t]);
  if (locked) return <Locked />;
  if (!games.games || !roster || !seasons) return <Wait games={games} />;

  const recorded = [...games.games].sort((a, b) => a.date.localeCompare(b.date)).filter(g => seasons.some(s => s.games.some(x => x.slug === g.slug)));
  const byName = new Map(seasons.map(s => [s.name, s]));
  const estimated = seasons[0]?.estimatedSlugs ?? new Set<string>();
  const players = [...roster.players].sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name));
  const day = (iso: string) => formatDate(iso, locale, "short");

  return (
    <div className="pg-players">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow"><T t={manifest.team} /></span>
          <h1>{t("playersTitle")} <span>{t("playersAccent")}</span></h1>
          <div className="record">
            <span><b>{players.length}</b> {t("playersCount")}</span>
            <span><b>{recorded.length}</b> / {games.games.length} {t("lineupsRecorded")}</span>
          </div>
        </div>
      </header>
      <main className="wrap">
        {!recorded.length ? <p className="sub empty">{t("noLineups")}</p> : <p className="sub">{t("playersSub")}</p>}
        <div className="table-wrap">
          <table className="nums squad">
            <thead>
              <tr>
                <th>{t("colNumber")}</th><th>{t("colPlayer")}</th><th>{t("colGamesPlayed")}</th><th>{t("colStarts")}</th>
                <th>{t("colMinutes")}</th><th>{t("colShare")}</th>
                {recorded.map(g => <th key={g.slug} className="g"><Link to={`/game/${g.slug}/coaches`}>{day(g.date)}{estimated.has(g.slug) ? " ≈" : ""}<br />{g.opponent}</Link></th>)}
              </tr>
            </thead>
            <tbody>
              {players.map(p => {
                const s = byName.get(p.name)!;
                return (
                  <tr key={p.name}>
                    <td>{p.number ?? ""}</td>
                    <th scope="row"><Link to={`/player/${playerId(p.name)}`}>{p.name}</Link></th>
                    <td>{s.games.length}</td><td>{s.starts}</td><td>{minutes(s.seconds)}'</td>
                    <td><span className="share"><span style={{ width: `${pct(s.seconds, s.available)}%` }}></span></span>{pct(s.seconds, s.available)}%</td>
                    {recorded.map(g => {
                      const x = s.games.find(y => y.slug === g.slug);
                      return <td key={g.slug} className={x ? (x.started ? "st" : "sub") : "dnp"}>{x ? `${minutes(x.seconds)}'` : "—"}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {recorded.length ? <p className="legend-line"><span className="st">{t("legendStarted")}</span><span className="sub">{t("legendSub")}</span><span className="dnp">— {t("legendDnp")}</span>{estimated.size ? <span>≈ {t("legendEstimated")}</span> : null}</p> : null}
      </main>
    </div>
  );
}

/** One game's moments for a player; with a confirmed lineup, positions in them read as names. */
function Moments({ g, x }: { g: PublicGame; x: PlayerGame }) {
  const { manifest } = useSite();
  const i18n = useI18n();
  const { tx, halfRef } = i18n;
  const named = useNamer(g) ?? ((_, text: string) => text);
  return (
    <ul className="moments">
      {x.moments.map(({ e, pos }) => (
        <li key={e.id}>
          <Link className="mono" to={`/game/${x.slug}/play-by-play`}>{halfRef(`${e.h}H ${e.c}`)}</Link>
          <span className={`chip ${e.t}`}><i></i>{eventLabel(i18n, manifest.us, g, e)}</span>
          <span className="desc"><b>{pos}</b> · <Md s={named(e, tx(e.d))} /></span>
        </li>
      ))}
    </ul>
  );
}

export function Player() {
  const { id = "" } = useParams();
  const { manifest } = useSite();
  const { t } = useI18n();
  const { locked, games, roster, seasons } = useSquad();
  const p = roster?.players.find(x => playerId(x.name) === id);
  useEffect(() => { document.title = `${manifest.us} · ${p ? p.name : t("players")}`; }, [manifest.us, p, t]);
  if (locked) return <Locked />;
  if (!games.games || !roster || !seasons) return <Wait games={games} />;
  if (!p) return <div className="status wrap"><p>{t("noSuchPlayer")}</p><Link className="btn-line" to="/players">{t("players")}</Link></div>;
  return <PlayerView name={p.name} label={playerLabel(p)} listed={p.positions} s={seasons.find(x => x.name === p.name)!} games={games.games} roster={roster} />;
}

function PlayerView({ label, listed, s, games }: { name: string; label: string; listed: string[]; s: PlayerSeason; games: PublicGame[]; roster: Roster }) {
  const { t, locale } = useI18n();
  const byslug = new Map(games.map(g => [g.slug, g]));
  return (
    <div className="pg-players">
      <header className="strip">
        <div className="wrap">
          <Link className="eyebrow back" to="/players">← {t("players")}</Link>
          <h1>{label}</h1>
          <div className="record">
            <span>{t("listedAt")} <b><Md s={listed.join(" · ") || "—"} /></b></span>
            <span><b>{s.games.length}</b> / {s.recorded} {t("colGamesPlayed").toLowerCase()}</span>
            <span><b>{s.starts}</b> {t("colStarts").toLowerCase()}</span>
            <span><b>{minutes(s.seconds)}'</b> ({pct(s.seconds, s.available)}%)</span>
          </div>
        </div>
      </header>
      <main className="wrap">
        {!s.recorded ? <p className="sub empty">{t("noLineups")}</p> : !s.games.length ? <p className="sub empty">{t("didNotPlay")}</p> : null}

        {s.positions.length ? (
          <section className="sec">
            <div className="sec-head"><span className="eyebrow">{t("positionsPlayed")}</span><h2>{t("whereTheyPlayed")}</h2></div>
            <ul className="pos-bars">
              {s.positions.map(x => (
                <li key={x.pos}><span className="p"><Md s={x.pos} /></span><span className="share"><span style={{ width: `${pct(x.seconds, s.seconds)}%` }}></span></span><span className="mono">{minutes(x.seconds)}'</span></li>
              ))}
            </ul>
          </section>
        ) : null}

        {s.games.length ? (
          <section className="sec">
            <div className="sec-head"><span className="eyebrow">{t("gameByGame")}</span><h2>{t("theirGames")}</h2><p className="sub">{t("momentsSub")}</p></div>
            {[...s.games].reverse().map(x => {
              const g = byslug.get(x.slug)!;
              return (
                <article key={x.slug} className="pgame">
                  <div className="pg-head">
                    <h3><Link to={`/game/${x.slug}/coaches`}><span className="vs">{t("vs")}</span>{x.opponent}</Link></h3>
                    <span className="mono">{formatDate(x.date, locale, "short")} · {g.score.us}–{g.score.them}</span>
                    <span className="mono">{minutes(x.seconds)}' · {x.started ? t("started") : t("cameOn")} · <Md s={x.positions.join(" → ")} />{x.estimated ? ` · ≈ ${t("legendEstimated")}` : ""}</span>
                  </div>
                  {x.moments.length ? <Moments g={g} x={x} /> : <p className="sub">{t("noMoments")}</p>}
                </article>
              );
            })}
          </section>
        ) : null}
      </main>
    </div>
  );
}
