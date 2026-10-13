import { useState } from "react";
import { Md, T } from "../components/RichText";
import { NoteButton, useNoteCounts } from "../components/Notes";
import { useI18n, type Key } from "../i18n";
import { gameMinute, mmss, videoSec, workingClip } from "../lib/time";
import type { PublicGame as Game, GameEvent } from "../schema";
import { useSite } from "../site";
import { eventLabel, useDateLine } from "./shared";

type Kind = "all" | "goal" | "shot" | "to" | "win" | "build" | "set";
const kinds = (e: GameEvent): string[] => {
  switch (e.y) {
    case "Goal": return ["goal", "shot"];
    case "Shot": return ["shot"];
    case "Turnover": return ["to"];
    case "Ball win": case "Save": return ["win"];
    case "Pass": case "Run": return ["build"];
    case "Corner": case "Throw-in": case "Yellow": case "Red": case "Foul": case "Free kick": case "Sub": return ["set"];
    default: return ["whistle"];
  }
};

const KIND_BUTTONS: [Kind, Key][] = [
  ["all", "everything"], ["goal", "goals"], ["shot", "shotsGoals"], ["to", "turnovers"],
  ["win", "ballWins"], ["build", "passesRuns"], ["set", "setPieces"],
];

export function PlayByPlay({ game: g }: { game: Game }) {
  const US = useSite().manifest.us;
  const { t } = useI18n();
  const [team, setTeam] = useState<"all" | "D" | "O">("all");
  const [kind, setKind] = useState<Kind>("all");
  const count = useNoteCounts(g.slug);
  const showGame = g.video.minute !== null;

  const visible = (e: GameEvent) => {
    const k = kinds(e);
    if (k[0] === "whistle") return kind === "all" && team === "all";
    if (team !== "all" && e.t !== team) return false;
    return kind === "all" || k.includes(kind);
  };
  const total = g.events.filter(e => e.t !== "N").length;
  const shown = g.events.filter(e => e.t !== "N" && visible(e)).length;

  const dateLine = useDateLine(g);

  return (
    <div className="pg-pbp">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow">{t("playByPlay")} · {dateLine}</span>
          <div className="strip-row">
            <h1><span className="d">{US}</span> <span className="n">{g.score.us}–{g.score.them}</span> <span className="o">{g.opponent}</span></h1>
            <div className="goals">{g.goals.map((x, i) => <span key={i} className={x.t}><T t={x.label} /></span>)}</div>
          </div>
          <span className="eyebrow"><T t={g.competition} /> · {t("ht")} {g.score.htUs}–{g.score.htThem}</span>
        </div>
      </header>

      <main className="wrap">
        <div className="filters" role="group" aria-label={t("filterEvents")}>
          <div className="f-row">
            <span className="f-label">{t("team")}</span>
            {([["all", t("both")], ["D", US], ["O", g.opponent]] as const).map(([v, l]) => (
              <button key={v} className="f-btn" type="button" aria-pressed={team === v} onClick={() => setTeam(v)}>{l}</button>
            ))}
          </div>
          <div className="f-row">
            <span className="f-label">{t("show")}</span>
            {KIND_BUTTONS.map(([v, k]) => (
              <button key={v} className="f-btn" type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{t(k)}</button>
            ))}
            <span className="f-count" aria-live="polite">{t("eventsShown", { n: shown, total })}</span>
          </div>
        </div>

        {g.halves.map((half, i) => {
          const h = (i + 1) as 1 | 2;
          const list = g.events.filter(e => e.h === h && visible(e));
          const cols = showGame ? 7 : 6;
          return (
            <section key={h} className="half" id={`h${h}`}>
              <div className="half-head">
                <h2><T t={half.title} /></h2>
                <span className="meta"><T t={half.meta} /></span>
              </div>
              <div className="ledger-scroll">
                <table>
                  <thead><tr>
                    <th>{t("colClock")}</th>{showGame ? <th>{t("colGame")}</th> : null}<th>{t("colVideo")}</th>
                    <th>{t("colClip")}</th><th>{t("colEvent")}</th><th>{t("colWhat")}</th><th aria-label={t("notes")}></th>
                  </tr></thead>
                  <tbody>
                    {list.length ? list.map(e => <Row key={e.id} g={g} e={e} showGame={showGame} count={count(`event:${e.id}`)} />)
                      : <tr><td colSpan={cols} className="empty">{t("nothingLogged")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <footer className="foot">{g.playByPlayFooter.map((p, i) => <p key={i}><T t={p} /></p>)}</footer>
      </main>
    </div>
  );
}

function Row({ g, e, showGame, count }: { g: Game; e: GameEvent; showGame: boolean; count: number }) {
  const US = useSite().manifest.us;
  const i18n = useI18n();
  const { t, tx } = i18n;
  const v = videoSec(g, e), clip = workingClip(g, v);
  const whistle = e.t === "N", goal = e.y === "Goal";
  const cls = [e.t, goal ? "goal" : "", whistle ? "whistle" : ""].join(" ").trim();
  const chip = `chip ${e.t}${e.y === "Yellow" ? " yellow" : e.y === "Red" ? " red" : ""}`;
  const min = gameMinute(g, e);
  const label = eventLabel(i18n, US, g, e);
  return (
    <tr className={cls}>
      <td className="num">{e.c}</td>
      {showGame ? <td className="num min">{whistle && e.y !== "Kickoff" ? "" : `${min}'`}</td> : null}
      <td className="num">{mmss(v)}</td>
      <td className="clip"><b>{clip.label}</b> @ {clip.at}</td>
      <td>
        <span className={chip}><i></i>{label}</span>
        {e.y === "Shot" && e.on !== undefined ? <span className="res">{e.on ? t("onTarget") : t("offTarget")}</span> : null}
      </td>
      <td className="desc"><Md s={tx(e.d)} />{e.f ? <span className="note"><Md s={tx(e.f)} /></span> : null}</td>
      <td className="nb"><NoteButton slug={g.slug} anchor={`event:${e.id}`} label={`${e.h === 1 ? t("half1") : t("half2")} ${e.c} · ${label}`} count={count} /></td>
    </tr>
  );
}
