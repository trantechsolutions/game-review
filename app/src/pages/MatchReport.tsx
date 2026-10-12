import { Md, T } from "../components/RichText";
import { NoteButton, useNoteCounts } from "../components/Notes";
import { useI18n, type Key } from "../i18n";
import { mmss, sec, videoSec, workingClip } from "../lib/time";
import type { Game, GameEvent } from "../schema";
import { useSite } from "../site";
import { eventLabel, SecHead, useDateLine } from "./shared";

export function MatchReport({ game: g }: { game: Game }) {
  const US = useSite().manifest.us;
  const { t, tx } = useI18n();
  const count = useNoteCounts(g.slug);
  const R = g.report;
  const dateLine = useDateLine(g);
  const byId = new Map(g.events.map(e => [e.id, e]));

  return (
    <div className="pg-report">
      <header className="board">
        <div className="wrap">
          <div className="board-top">
            <span className="eyebrow"><T t={R.eyebrow} /></span>
            <span className="eyebrow">{dateLine}</span>
          </div>
          <div className="score" aria-label={`${US} ${g.score.us}, ${g.opponent} ${g.score.them}`}>
            <div className="team home"><span className="team-name">{US}</span><span className="team-scorers"><T t={R.scorers.us} /></span></div>
            <div className="digits"><span className="digit home">{g.score.us}</span><span className="dash">–</span><span className="digit away">{g.score.them}</span></div>
            <div className="team away"><span className="team-name">{g.opponent}</span><span className="team-scorers"><T t={R.scorers.them} /></span></div>
          </div>
          <div className="board-foot">{R.board.map((b, i) => <span key={i}><T t={b} /></span>)}</div>
        </div>
      </header>

      <main className="wrap">
        <nav className="toc" aria-label={t("sections")}>
          <a href="#story">{t("story")}</a><a href="#first-half">{t("half1")}</a><a href="#second-half">{t("half2")}</a>
          <a href="#numbers">{t("numbers")}</a><a href="#takeaways">{t("takeaways")}</a><a href="#clips">{t("clips")}</a>
        </nav>

        <section className="sec" id="story">
          <SecHead g={g} page="report" id="story" eyebrow={<T t={R.story.eyebrow} />} title={tx(R.story.title)} count={count} />
          <p className="lede"><T t={R.story.lede} /></p>
          <div className="tl-box">
            <Timeline g={g} />
            <div className="legend">
              <span><i className="sw" style={{ background: "var(--dfc)" }}></i>{t("shotAbove", { team: US })}</span>
              <span><i className="sw" style={{ background: "var(--opp)" }}></i>{t("shotBelow", { team: g.opponent })}</span>
              <span>{t("largeGoal")}</span>
              {R.story.legendNote ? <span><T t={R.story.legendNote} /></span> : null}
            </div>
          </div>
        </section>

        {R.halves.map((half, i) => {
          const h = (i + 1) as 1 | 2;
          const id = h === 1 ? "first-half" : "second-half";
          const evs = g.events.filter(e => e.h === h);
          return (
            <section key={h} className="sec" id={id}>
              <SecHead g={g} page="report" id={id} eyebrow={<T t={half.eyebrow} />} title={tx(half.title)} count={count} />
              <div className="half-meta">
                {half.pills.map((p, j) => <span key={j} className={`pill${j === 0 ? " score-pill" : ""}`}><T t={p} /></span>)}
              </div>
              <div>
                {half.phases.map((p, j) => (
                  <div key={j} className="phase">
                    <div className="phase-intro">
                      <span className="range"><T t={p.range} /></span>
                      <h3><T t={p.title} /></h3>
                      <p><T t={p.read} /></p>
                    </div>
                    <ul className="events">
                      {p.events.map(ref => {
                        const r = typeof ref === "string" ? { id: ref } : ref;
                        const e = byId.get(r.id);
                        return e ? <ReportEvent key={r.id} g={g} e={e} d={r.d ? tx(r.d) : undefined} label={r.label ? tx(r.label) : undefined} count={count(`event:${e.id}`)} /> : null;
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <MiniStats g={g} events={evs} />
            </section>
          );
        })}

        <section className="sec" id="numbers">
          <SecHead g={g} page="report" id="numbers" eyebrow={<T t={R.numbers.eyebrow} />} title={tx(R.numbers.title)} sub={R.numbers.sub ? <T t={R.numbers.sub} /> : undefined} count={count} />
          {R.numbers.tables.map((tb, i) => (
            <div key={i} className="bars">
              {tb.title ? <span className="bars-title"><T t={tb.title} /></span> : null}
              <div className="bars-head"><span className="dfc-t">{US}</span><span></span><span className="r opp-t">{g.opponent}</span></div>
              {tb.rows.map((r, j) => {
                const max = Math.max(r.us, r.them, 1);
                return (
                  <div key={j} className="bar-row">
                    <div className="bar-side l"><span className="bar-num dfc-t">{r.us}{r.unit ?? ""}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(r.us / max) * 100}%` }}></span></span></div>
                    <div className="bar-label"><T t={r.label} /></div>
                    <div className="bar-side r"><span className="bar-num opp-t">{r.them}{r.unit ?? ""}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(r.them / max) * 100}%` }}></span></span></div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <section className="sec" id="takeaways">
          <SecHead g={g} page="report" id="takeaways" eyebrow={<T t={R.takeaways.eyebrow} />} title={tx(R.takeaways.title)} count={count} />
          <div className="cols">
            {([[R.takeaways.decidedTitle, R.takeaways.decided], [R.takeaways.workTitle, R.takeaways.work]] as const).map(([title, points], i) => (
              <div key={i} className="col">
                <h3><T t={title} /></h3>
                <ul className="points">
                  {points.map((p, j) => (
                    <li key={j}><b><T t={p.title} /></b>{p.tag ? <span className="tag"><T t={p.tag} /></span> : null}<p><T t={p.body} /></p></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="sec" id="clips">
          <SecHead g={g} page="report" id="clips" eyebrow={<T t={R.clips.eyebrow} />} title={tx(R.clips.title)} sub={<T t={R.clips.sub} />} count={count} />
          <div className="clips">
            {R.clips.items.map((c, i) => (
              <div key={i} className={`clip ${c.t}`}><span className="what"><T t={c.what} /></span><span className="at">{c.at}</span><span className="file">{c.file}</span></div>
            ))}
          </div>
        </section>

        <footer className="foot">{R.footer.map((p, i) => <p key={i}><T t={p} /></p>)}</footer>
      </main>
    </div>
  );
}

function ReportEvent({ g, e, d, label, count }: { g: Game; e: GameEvent; d?: string; label?: string; count: number }) {
  const US = useSite().manifest.us;
  const i18n = useI18n();
  const { t, tx } = i18n;
  const v = videoSec(g, e), clip = workingClip(g, v);
  const cls = ["ev", e.t, e.y === "Goal" ? "goal" : "", e.key ? "key" : "", e.t === "N" ? "whistle" : ""].filter(Boolean).join(" ");
  const chip = `chip ${e.t}${e.y === "Yellow" ? " yellow" : e.y === "Red" ? " red" : ""}`;
  const text = eventLabel(i18n, US, g, e, label);
  return (
    <li className={cls}>
      <span className="clock">{e.c}
        <span className="video">{t("vid")} {mmss(v)}</span>
        <span className="video"><b>{clip.label}</b> {clip.at}</span>
      </span>
      <span className={chip}><i></i>{text}</span>
      <span className="desc">
        {d !== undefined ? <Md s={d} /> : <><Md s={tx(e.d)} />{e.f ? <> <i><Md s={tx(e.f)} /></i></> : null}</>}
        {e.y === "Shot" && e.on !== undefined ? <> <i>({e.on ? t("onTarget") : t("offTarget")})</i></> : null}
        {" "}<NoteButton slug={g.slug} anchor={`event:${e.id}`} label={`${e.h === 1 ? t("half1") : t("half2")} ${e.c} · ${text}`} count={count} />
      </span>
    </li>
  );
}

const STATS: [Key, (e: GameEvent) => boolean][] = [
  ["statGoals", e => e.y === "Goal"],
  ["statShots", e => e.y === "Goal" || e.y === "Shot"],
  ["statOn", e => e.y === "Goal" || (e.y === "Shot" && !!e.on)],
  ["statTurnovers", e => e.y === "Turnover"],
  ["statWins", e => e.y === "Ball win"],
  ["statCards", e => e.y === "Yellow" || e.y === "Red"],
];

function MiniStats({ g, events }: { g: Game; events: GameEvent[] }) {
  const US = useSite().manifest.us;
  const { t } = useI18n();
  return (
    <div className="mini-stats">
      {STATS.map(([k, f]) => {
        const d = events.filter(e => e.t === "D" && f(e)).length, o = events.filter(e => e.t === "O" && f(e)).length;
        return (
          <div key={k} className="ms"><span className="eyebrow">{t(k)}</span>
            <span className="vals"><span className="dfc-t">{d}</span><span className="sep">{US} · {g.opponent}</span><span className="opp-t">{o}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/** Shots above (DFC) and below (opponent) a line, one x-scale across both halves. */
function Timeline({ g }: { g: Game }) {
  const US = useSite().manifest.us;
  const { t } = useI18n();
  const W = 1000, L = 52, R = 24, GAP = 44, MID = 125;
  const len1 = sec(g.video.halfLength[1]), len2 = sec(g.video.halfLength[2]);
  const k = (W - L - R - GAP) / (len1 + len2);
  const htX = L + len1 * k;
  const x = (h: 1 | 2, c: string) => (h === 1 ? L + sec(c) * k : htX + GAP + sec(c) * k);
  const offset = g.video.minute ? 30 : 0;

  const ticks: { x: number; label: string }[] = [];
  ([[1, len1], [2, len2]] as const).forEach(([h, len]) => {
    for (let m = 0; m * 60 <= len; m += 5) ticks.push({ x: x(h, `${m}:00`), label: `${h === 2 ? m + offset : m}'` });
  });

  let us = 0, them = 0;
  const marks = g.events.filter(e => e.y === "Shot" || e.y === "Goal").map(e => {
    const goal = e.y === "Goal";
    if (goal) { if (e.t === "D") us++; else them++; }
    const up = e.t === "D" ? -1 : 1;
    const xx = x(e.h, e.c), yy = MID + up * (goal ? 76 : 44);
    const cl = e.t === "D" ? "d" : "o";
    return (
      <g key={e.id}>
        <line className={`stem-${cl}`} x1={xx} x2={xx} y1={MID} y2={yy} />
        {goal ? <>
          <circle className={`dot-${cl}`} cx={xx} cy={yy} r={10} />
          <text className="tl-score" x={xx} y={yy + up * 18 + (up < 0 ? 0 : 10)} textAnchor="middle">{us}–{them}</text>
        </> : <circle className="ring" style={{ stroke: `var(--${e.t === "D" ? "dfc" : "opp"})` }} cx={xx} cy={yy} r={5.5} />}
      </g>
    );
  });

  return (
    <svg viewBox="0 0 1000 250" role="img" aria-label={t("timelineLabel", { us: US })}>
      <rect className="tl-ht" x={htX} y={20} width={GAP} height={210} rx={4} />
      <text className="tl-half" x={htX + GAP / 2} y={MID + 4} textAnchor="middle">{t("ht")}</text>
      <text className="tl-half" x={L} y={14}>{t("half1")}</text>
      <text className="tl-half" x={htX + GAP} y={14}>{t("half2")}</text>
      <line className="tl-mid" x1={L} x2={htX} y1={MID} y2={MID} />
      <line className="tl-mid" x1={htX + GAP} x2={W - R} y1={MID} y2={MID} />
      {ticks.map((tk, i) => (
        <g key={i}><line className="tl-axis" x1={tk.x} x2={tk.x} y1={30} y2={220} /><text className="tl-tick" x={tk.x} y={243} textAnchor="middle">{tk.label}</text></g>
      ))}
      <text className="tl-label dfc-t" x={4} y={MID - 70}>{US}</text>
      <text className="tl-label opp-t" x={4} y={MID + 78}>{g.opponent}</text>
      {marks}
    </svg>
  );
}
