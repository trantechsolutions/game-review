// The scorekeeper's pitch and its drag-and-drop. Scorekeeper mode is landscape only: the pitch lies
// sideways with our goal on the left, or on the right for a half where `flip` turns it round. Logical
// coordinates are the LineupPitch ones: x from our goal line (0) to theirs (100), y from our left touchline.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

export type Drop = { kind: "token"; id: string } | { kind: "none" };

/** True while the screen is taller than wide: scorekeeper mode then asks for the phone to be turned. */
export function usePortrait() {
  const q = "(orientation: portrait)";
  const [p, setP] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setP(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return p;
}

/** Screen position (percent of the pitch box) for a logical point. */
export const place = (x: number, y: number, flip = false) =>
  flip ? { left: `${100 - x}%`, top: `${100 - y}%` } : { left: `${x}%`, top: `${y}%` };

function hit(clientX: number, clientY: number): Drop {
  const tok = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-drop]");
  return tok?.dataset.drop ? { kind: "token", id: tok.dataset.drop } : { kind: "none" };
}

/** Drag anything onto a token or a drop zone. A press that barely moves is a tap; one held still for half
 *  a second is a long press. */
export function useDrag(onDrop: (src: string, d: Drop) => void, onTap: (src: string) => void, onLong?: (src: string) => void) {
  const [ghost, setGhost] = useState<{ x: number; y: number; label: ReactNode; src: string } | null>(null);
  const cb = useRef({ onDrop, onTap, onLong });
  cb.current = { onDrop, onTap, onLong };

  const start = useCallback((e: RPointerEvent, src: string, label: ReactNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, long = false;
    const timer = setTimeout(() => { if (!moved && cb.current.onLong) { long = true; cb.current.onLong(src); } }, 500);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      setGhost(null);
    };
    const move = (ev: PointerEvent) => {
      if (long || (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8)) return;
      moved = true;
      clearTimeout(timer);
      setGhost({ x: ev.clientX, y: ev.clientY, label, src });
    };
    const up = (ev: PointerEvent) => {
      stop();
      if (long) return;
      if (!moved) { cb.current.onTap(src); return; }
      const d = hit(ev.clientX, ev.clientY);
      if (d.kind === "token" && d.id === src) return;
      cb.current.onDrop(src, d);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
  }, []);

  const layer = ghost ? <div className="kp-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">{ghost.label}</div> : null;
  return { start, layer, dragging: ghost?.src ?? null };
}

/** Pitch markings. */
export function Pitch({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="kp-pitch" role="group" aria-label={label}>
      <svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
        <rect className="pl" x="30" y="25" width="940" height="570" />
        <line className="pl" x1="500" y1="25" x2="500" y2="595" />
        <circle className="pl" cx="500" cy="310" r="70" />
        <circle className="pl-dot" cx="500" cy="310" r="4" />
        <rect className="pl" x="30" y="165" width="135" height="290" />
        <rect className="pl" x="30" y="245" width="48" height="130" />
        <rect className="pl" x="835" y="165" width="135" height="290" />
        <rect className="pl" x="922" y="245" width="48" height="130" />
        <rect className="goal" x="14" y="275" width="16" height="70" />
        <rect className="goal" x="970" y="275" width="16" height="70" />
      </svg>
      {children}
    </div>
  );
}
