import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { HalfLengths, Stint } from "../lib/lineup";
import { SPOT, type RosterPlayer } from "../lib/positions";
import { mmss } from "../lib/time";
import { useSite } from "../site";

const clock = (s: number) => mmss(s).replace(/^0(\d)/, "$1");

/** The lineup on a pitch, with a timeline to drag through the game. Markers move as players
 *  change position; ticks on the timeline mark every substitution and position change. */
export function LineupPitch({ stints, len, players }: { stints: Stint[]; len: HalfLengths; players?: RosterPlayer[] }) {
  const { t, halfRef } = useI18n();
  const { manifest } = useSite();
  const end = len[1] + len[2];
  const [at, setAt] = useState(0);

  // Every moment the lineup changes (start excluded), oldest first.
  const marks = useMemo(() => [...new Set(stints.map(s => s.from).filter(x => x > 0))].sort((a, b) => a - b), [stints]);
  const on = stints.filter(s => s.from <= at && (at < s.to || (at === end && s.to === end)));
  const onNames = new Set(on.map(s => s.player));
  const bench = [...new Set(stints.map(s => s.player))].filter(p => !onNames.has(p));
  const label = (s: number) => (s === 0 ? t("lineupStart") : s >= end ? t("fullTime")
    : halfRef(s < len[1] ? `1H ${clock(s)}` : `2H ${clock(s - len[1])}`));
  const number = (name: string) => players?.find(p => p.name === name)?.number;
  const short = (name: string) => name.split(" ")[0];

  // Two players logged at the same spot (a mid-change moment) sit side by side instead of on top.
  const taken = new Map<string, number>();
  const placed = on.map(s => {
    const [x, y] = SPOT[s.pos] ?? [50, 50];
    const n = taken.get(s.pos) ?? 0;
    taken.set(s.pos, n + 1);
    return { s, x: x + n * 6, y };
  });

  // What changed at this exact moment (or the last change before it), for the caption.
  const last = [...marks].reverse().find(m => m <= at);
  const cameOn = last === undefined ? [] : stints.filter(s => s.from === last);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? marks.find(m => m > at) ?? end : [...marks].reverse().find(m => m < at) ?? 0;
    setAt(next);
  };

  return (
    <div className="lp">
      <div className="lp-pitch" role="img" aria-label={`${t("lineupAt", { at: label(at) })}: ${on.map(s => `${s.pos} ${s.player}`).join(", ")}`}>
        <svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
          <rect className="pl" x="10" y="10" width="980" height="600" />
          <line className="pl" x1="500" y1="10" x2="500" y2="610" />
          <circle className="pl" cx="500" cy="310" r="72" />
          <circle className="pl-dot" cx="500" cy="310" r="4" />
          <rect className="pl" x="10" y="160" width="140" height="300" />
          <rect className="pl" x="10" y="240" width="50" height="140" />
          <rect className="pl" x="850" y="160" width="140" height="300" />
          <rect className="pl" x="940" y="240" width="50" height="140" />
        </svg>
        {placed.map(({ s, x, y }) => (
          <div key={s.player} className="lp-mark" style={{ left: `${x}%`, top: `${y}%` }}>
            <span className="dot">{number(s.player) ?? s.pos}</span>
            <span className="name">{short(s.player)}<i>{s.pos}</i></span>
          </div>
        ))}
        <span className="lp-dir">{t("attackDir", { us: manifest.us })}</span>
      </div>

      <div className="lp-controls">
        <button type="button" className="btn-line" onClick={() => step(-1)} disabled={at === 0} aria-label={t("prevChange")}>←</button>
        <div className="lp-track">
          <input type="range" min={0} max={end} step={1} value={at} onChange={e => setAt(Number(e.target.value))}
            aria-label={t("lineupTimeline")} aria-valuetext={label(at)} />
          <div className="lp-ticks" aria-hidden="true">
            <span className="ht" style={{ left: `${(len[1] / end) * 100}%` }}></span>
            {marks.map(m => <span key={m} style={{ left: `${(m / end) * 100}%` }}></span>)}
          </div>
          <div className="lp-scale" aria-hidden="true"><span>{t("half1")}</span><span>{t("ht")}</span><span>{t("half2")}</span></div>
        </div>
        <button type="button" className="btn-line" onClick={() => step(1)} disabled={at === end} aria-label={t("nextChange")}>→</button>
      </div>

      <div className="lp-info">
        <p className="lp-at"><b>{label(at)}</b>{last !== undefined && cameOn.length ? <span> · {t("lastChange", { at: label(last) })}: {cameOn.map(s => `${short(s.player)} ${s.pos}`).join(", ")}</span> : null}</p>
        {bench.length ? <p className="lp-bench"><span className="eyebrow">{t("bench")}</span> {bench.map(short).join(" · ")}</p> : null}
      </div>
    </div>
  );
}
