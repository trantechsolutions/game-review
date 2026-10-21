// The header every game page shares: which game this is (score, opponent, date, scorers), the way back to the
// library and to the games either side, and the game's pages as tabs that stay in view while scrolling.
import { useEffect, useRef } from "react";
import { Link, NavLink } from "react-router-dom";
import { useI18n, type Key } from "../i18n";
import type { PublicGame as Game } from "../schema";
import { useSite } from "../site";
import { useDateLine } from "../pages/shared";
import { T } from "./RichText";

export function GameHeader({ g, page, tabs }: { g: Game; page: string; tabs: [id: string, label: Key][] }) {
  const { manifest } = useSite();
  const { t } = useI18n();
  const dateLine = useDateLine(g);
  const US = manifest.us;
  // The list line often ends with the venue, which the date line already gives.
  const strip = (x: string) => x.replace(/\s*·\s*(Home|Away|Local|Visitante)\s*$/i, "");
  const context = strip(g.listContext.en) ? { en: strip(g.listContext.en), es: strip(g.listContext.es) || strip(g.listContext.en) } : null;
  // Oldest to newest, so "previous" is the game before this one.
  const order = [...manifest.games].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const at = order.findIndex(x => x.slug === g.slug);
  const prev = at > 0 ? order[at - 1] : null, next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const nav = useRef<HTMLElement>(null);
  // On a narrow screen the tabs scroll sideways; keep the current one in view.
  useEffect(() => { nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" }); }, [page]);

  return (
    <>
      <header className="gh">
        <div className="wrap">
          <div className="gh-top">
            <Link className="gh-back" to="/library">‹ {t("library")}</Link>
            <span className="eyebrow">{dateLine}{context ? <> · <T t={context} /></> : null}</span>
          </div>
          <div className="gh-main">
            <h1 className="gh-score" aria-label={`${US} ${g.score.us}, ${g.opponent} ${g.score.them}`}>
              <span className="d">{US}</span> <span className="n">{g.score.us}–{g.score.them}</span> <span className="o">{g.opponent}</span>
            </h1>
            <div className="gh-facts">
              <span className="ht">{t("ht")} {g.score.htUs}–{g.score.htThem}</span>
              {g.goals.map((x, i) => <span key={i} className={`goal ${x.t}`}><T t={x.label} /></span>)}
            </div>
          </div>
          <div className="gh-step">
            {prev ? <Link to={`/game/${prev.slug}/${page}`} title={t("ghPrev")}>‹ {prev.us}–{prev.them} {prev.opponent}</Link> : <span />}
            {next ? <Link to={`/game/${next.slug}/${page}`} title={t("ghNext")}>{next.us}–{next.them} {next.opponent} ›</Link> : <span />}
          </div>
        </div>
      </header>
      <nav className="gtabs" ref={nav} aria-label={t("ghPages")}>
        <div className="wrap">
          {tabs.map(([id, label]) => <NavLink key={id} to={`/game/${g.slug}/${id}`}>{t(label)}</NavLink>)}
        </div>
      </nav>
    </>
  );
}
