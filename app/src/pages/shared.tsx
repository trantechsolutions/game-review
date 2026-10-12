import type { ReactNode } from "react";
import { NoteButton } from "../components/Notes";
import { formatDate, useI18n } from "../i18n";
import type { Game, GameEvent } from "../schema";

type I18n = ReturnType<typeof useI18n>;

/** "<us> Goal", "<opponent> Shot", "Kickoff" — the chip text for an event. */
export function eventLabel({ ev }: I18n, us: string, g: Game, e: GameEvent, override?: string) {
  const team = e.t === "D" ? `${us} ` : e.t === "O" ? `${g.opponent} ` : "";
  return `${team}${override ?? ev(e.y)}`;
}

/** "Sunday 11 October 2026 · 13:30 · Home" */
export function useDateLine(g: Game) {
  const { locale, lang } = useI18n();
  const where = g.home === null ? "" : g.home ? (lang === "es" ? "Local" : "Home") : (lang === "es" ? "Visitante" : "Away");
  return [formatDate(g.date, locale), g.time, where].filter(Boolean).join(" · ");
}

/** A section heading with an eyebrow, a title, an optional sub line and a note button. */
export function SecHead({ g, page, id, eyebrow, title, sub, count }: {
  g: Game; page: string; id: string; eyebrow: ReactNode; title: ReactNode; sub?: ReactNode;
  count: (anchor: string) => number;
}) {
  const anchor = `section:${page}/${id}`;
  const label = typeof title === "string" ? title : "";
  return (
    <div className="sec-head">
      <span className="eyebrow">{eyebrow}</span>
      <div className="row">
        <h2>{title}</h2>
        <NoteButton slug={g.slug} anchor={anchor} label={label || id} count={count(anchor)} />
      </div>
      {sub ? <p className="sub">{sub}</p> : null}
    </div>
  );
}
