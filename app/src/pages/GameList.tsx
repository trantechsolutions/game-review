import { Link } from "react-router-dom";
import { T } from "../components/RichText";
import { useI18n } from "../i18n";
import { useSite } from "../site";

const outcome = (us: number, them: number) => (us > them ? "W" : us < them ? "L" : "D");
const LETTER_ES = { W: "G", D: "E", L: "P" } as const;

export function GameList() {
  const { manifest } = useSite();
  const { t, lang, locale } = useI18n();
  // Newest first; same-day games keep manifest order.
  const games = manifest.games.map((g, i) => ({ ...g, i })).sort((a, b) => b.date.localeCompare(a.date) || a.i - b.i);
  const w = games.filter(g => outcome(g.us, g.them) === "W").length;
  const d = games.filter(g => outcome(g.us, g.them) === "D").length;
  const l = games.length - w - d;
  const gf = games.reduce((s, g) => s + g.us, 0), ga = games.reduce((s, g) => s + g.them, 0);

  const day = (iso: string) => {
    const [y, m, dd] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    return { day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dt), year: y };
  };

  return (
    <div className="pg-list">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow"><T t={manifest.team} /></span>
          <h1>{lang === "es" ? <>Biblioteca de <span>partidos</span></> : <>Game <span>film</span> library</>}</h1>
          <div className="record">
            <span><b>{games.length}</b> {t("gamesReviewed")}</span>
            <span>{t("record")} <b>{w}-{d}-{l}</b></span>
            <span>{t("goalsFor")} <b>{gf}–{ga}</b></span>
          </div>
        </div>
      </header>
      <main className="wrap">
        <span className="eyebrow">{t("listIntro")}</span>
        <ol className="games">
          {games.map(g => {
            const f = day(g.date), o = outcome(g.us, g.them);
            const base = `/game/${g.slug}`;
            return (
              <li key={g.slug} className="game">
                <p className="date"><b>{f.day}</b>{f.year}{g.time ? ` · ${g.time}` : ""}</p>
                <div className="match">
                  <h2 className="opp"><span className="vs">{t("vs")}</span>{g.opponent}</h2>
                  <p className="ctx"><span className="res"><i className={o}>{lang === "es" ? LETTER_ES[o] : o}</i>{g.us}–{g.them}</span> · <T t={g.context} /></p>
                </div>
                <div className="links">
                  <Link className="pbp" to={`${base}/play-by-play`}>{t("playByPlay")}</Link>
                  <Link className="coach" to={`${base}/coaches`}>{t("coachesBreakdown")}</Link>
                  <Link className="units" to={`${base}/units`}>{t("unitReview")}</Link>
                  <Link className="hl" to={`${base}/highlights`}>{t("highlights")}</Link>
                  <Link className="rep" to={`${base}/report`}>{t("matchReport")}</Link>
                </div>
              </li>
            );
          })}
        </ol>
        <footer className="foot"><p>{t("listFooter")}</p></footer>
      </main>
    </div>
  );
}
