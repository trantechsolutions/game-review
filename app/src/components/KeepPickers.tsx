// The scorekeeper's tap-a-picture steps: where a shot was taken, where it went on the goal, where the ball
// crossed the line, and the little formation diagrams. Each turns a tap into logical coordinates
// (keeplog.ts: x from our goal line to theirs, y from our left touchline).
import { useState, type PointerEvent as RPointerEvent } from "react";
import type { Slot } from "../lib/keeplog";

const svgPoint = (e: RPointerEvent<SVGSVGElement>, w: number, h: number) => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
};

// The attacking end, goal at the top, drawn to scale: 100 units = the 68 m width.
const M = 100 / 68, DEPTH = 36 * M, LENGTH = 105;

/** Where a shot was taken, seen from behind the shooter. `side` "D" shoots at x = 100, "O" at x = 0. */
export function ShotSpot({ side, label, onPick }: { side: "D" | "O"; label: string; onPick: (x: number, y: number) => void }) {
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const box = { w: 40.3 * M, d: 16.5 * M }, six = { w: 18.3 * M, d: 5.5 * M }, goal = 7.32 * M, spot = 11 * M;
  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e, 100, DEPTH);
    setDot(p);
    const along = Math.min(100, (p.y / M / LENGTH) * 100), across = Math.min(100, Math.max(0, p.x));
    setTimeout(() => onPick(side === "D" ? 100 - along : along, side === "D" ? across : 100 - across), 180);
  };
  return (
    <svg className="kp-pick" viewBox={`0 0 100 ${DEPTH}`} role="img" aria-label={label} onPointerUp={pick}>
      <rect className="area" x="0" y="0" width="100" height={DEPTH} />
      {[1, 2].map(i => <line key={i} className="grid" x1={(100 / 3) * i} y1="0" x2={(100 / 3) * i} y2={DEPTH} />)}
      <line className="grid" x1="0" y1={box.d} x2="100" y2={box.d} />
      <rect className="ln" x={50 - box.w / 2} y="0" width={box.w} height={box.d} />
      <rect className="ln" x={50 - six.w / 2} y="0" width={six.w} height={six.d} />
      <path className="ln" d={`M ${50 - 7.3 * M} ${box.d} A ${9.15 * M} ${9.15 * M} 0 0 0 ${50 + 7.3 * M} ${box.d}`} />
      <circle className="dotln" cx="50" cy={spot} r="0.8" />
      <rect className="goalbar" x={50 - goal / 2} y="-1" width={goal} height="2" />
      {dot ? <circle className="hit" cx={dot.x} cy={dot.y} r="2.4" /> : null}
    </svg>
  );
}

// The goal from the front: posts at x 20 and 80, bar at y 14, ground at y 46.
const G = { l: 20, r: 80, bar: 14, ground: 46, w: 100, h: 50, wood: 1.6 };

export type GoalPick = { u: number; v: number; zone: "in" | "post" | "out" };

/** Where the shot went: inside the frame, off the woodwork, or wide or over. u runs post to post (0–1),
 *  v ground to bar (0–1); outside the frame they run past 0 or 1. */
export function GoalMouth({ label, onPick }: { label: string; onPick: (p: GoalPick) => void }) {
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e, G.w, G.h);
    setDot(p);
    const u = (p.x - G.l) / (G.r - G.l), v = (G.ground - p.y) / (G.ground - G.bar);
    const nearPost = (Math.abs(p.x - G.l) < G.wood || Math.abs(p.x - G.r) < G.wood) && v <= 1.05;
    const nearBar = Math.abs(p.y - G.bar) < G.wood && u >= -0.03 && u <= 1.03;
    const zone = nearPost || nearBar ? "post" : u >= 0 && u <= 1 && v >= 0 && v <= 1 ? "in" : "out";
    onPick({ u: Math.round(u * 100) / 100, v: Math.round(Math.max(0, v) * 100) / 100, zone });
  };
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map(i => G.l + ((G.r - G.l) / 9) * i);
  const rows = [1, 2, 3, 4, 5].map(i => G.bar + ((G.ground - G.bar) / 6) * i);
  return (
    <svg className="kp-pick goal" viewBox={`0 0 ${G.w} ${G.h}`} role="img" aria-label={label} onPointerUp={pick}>
      <rect className="area" x="0" y="0" width={G.w} height={G.h} />
      <line className="grid" x1="0" y1={G.bar} x2={G.l} y2={G.bar} />
      <line className="grid" x1={G.r} y1={G.bar} x2={G.w} y2={G.bar} />
      <line className="grid" x1={G.l} y1="5" x2={G.r} y2="5" />
      <line className="grid" x1="50" y1="0" x2="50" y2={G.bar} />
      {cols.map(x => <line key={x} className="net" x1={x} y1={G.bar} x2={x} y2={G.ground} />)}
      {rows.map(y => <line key={y} className="net" x1={G.l} y1={y} x2={G.r} y2={y} />)}
      <path className="frame" d={`M ${G.l} ${G.ground} V ${G.bar} H ${G.r} V ${G.ground}`} />
      <line className="grid" x1="0" y1={G.ground} x2={G.w} y2={G.ground} />
      {dot ? <><circle className="halo" cx={dot.x} cy={dot.y} r="5" /><circle className="hit" cx={dot.x} cy={dot.y} r="1.4" /></> : null}
    </svg>
  );
}

/** Where the ball crossed the line: a tap snaps to the nearest touchline or end line and lights that line
 *  up; the step's Next button confirms it. Drawn with our goal on the left unless `flip`, as the scorekeeper
 *  sees the pitch this half. `only` keeps the tap to one end line (a shot that went wide). */
export function LinePicker({ flip, labels, only, onPick }: {
  flip: boolean; labels: { aria: string; ours: string; theirs: string }; only?: "ours" | "theirs";
  onPick: (x: number, y: number, edge: "touch" | "ours" | "theirs") => void;
}) {
  const W = 100, H = 64, P = 3;
  const [dot, setDot] = useState<{ x: number; y: number; side: "l" | "r" | "t" | "b" } | null>(null);
  // Screen side of an end line: ours is on the left unless flipped.
  const screenSide = (edge: "ours" | "theirs") => ((edge === "ours") !== flip ? "l" : "r");
  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e, W + 2 * P, H + 2 * P);
    const sx = Math.min(W, Math.max(0, p.x - P)), sy = Math.min(H, Math.max(0, p.y - P));
    const d = { l: sx, r: W - sx, t: sy, b: H - sy };
    let side = (Object.keys(d) as (keyof typeof d)[]).reduce((m, k) => (d[k] < d[m] ? k : m), "l");
    if (only) side = screenSide(only);
    const snapped = side === "l" ? { x: 0, y: sy } : side === "r" ? { x: W, y: sy } : side === "t" ? { x: sx, y: 0 } : { x: sx, y: H };
    setDot({ ...snapped, side });
    // Back to logical coordinates: our goal at x = 0, our left touchline at y = 0.
    const lx = flip ? W - snapped.x : snapped.x, ly = ((flip ? H - snapped.y : snapped.y) / H) * 100;
    onPick(lx, Math.round(ly), lx === 0 ? "ours" : lx === W ? "theirs" : "touch");
  };
  const lit = dot ? { l: [0, 0, 0, H], r: [W, 0, W, H], t: [0, 0, W, 0], b: [0, H, W, H] }[dot.side] : null;
  return (
    <svg className="kp-pick line" viewBox={`0 0 ${W + 2 * P} ${H + 2 * P}`} role="img" aria-label={labels.aria} onPointerUp={pick}>
      <g transform={`translate(${P} ${P})`}>
        <rect className="band" x="-3" y="-3" width={W + 6} height={H + 6} />
        <rect className="area" x="4" y="6" width={W - 8} height={H - 12} />
        <rect className="ln" x="0" y="0" width={W} height={H} />
        <line className="ln" x1={W / 2} y1="0" x2={W / 2} y2={H} />
        <circle className="ln" cx={W / 2} cy={H / 2} r="9" />
        <rect className="ln" x="0" y={H / 2 - 20} width="16" height="40" />
        <rect className="ln" x={W - 16} y={H / 2 - 20} width="16" height="40" />
        <text className="lbl" x={W / 4} y={H / 2 + 2}>{flip ? labels.theirs : labels.ours}</text>
        <text className="lbl" x={(W * 3) / 4} y={H / 2 + 2}>{flip ? labels.ours : labels.theirs}</text>
        {only ? <line className="only" x1={screenSide(only) === "l" ? 0 : W} y1="0" x2={screenSide(only) === "l" ? 0 : W} y2={H} /> : null}
        {lit ? <line className="lit" x1={lit[0]} y1={lit[1]} x2={lit[2]} y2={lit[3]} /> : null}
        {dot ? <><circle className="halo" cx={dot.x} cy={dot.y} r="6" /><circle className="hit" cx={dot.x} cy={dot.y} r="1.8" /></> : null}
      </g>
    </svg>
  );
}

/** A formation as dots, goalkeeper on the left. */
export function FormationThumb({ slots }: { slots: Slot[] }) {
  return (
    <svg className="kp-thumb" viewBox="0 0 100 64" aria-hidden="true">
      <rect className="ln" x="1" y="1" width="98" height="62" />
      <rect className="ln" x="1" y="18" width="14" height="28" />
      <path className="ln" d="M 99 22 A 10 10 0 0 0 99 42" />
      {slots.map(([pos, x, y], i) => <circle key={i} className={pos === "GK" ? "gk" : "pl"} cx={x} cy={(y / 100) * 56 + 4} r="3.6" />)}
    </svg>
  );
}
