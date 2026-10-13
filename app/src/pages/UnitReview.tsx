import { T } from "../components/RichText";
import { NoteButton, useNoteCounts } from "../components/Notes";
import { useI18n, type Key } from "../i18n";
import type { PublicGame as Game } from "../schema";
import { useSite } from "../site";
import { Toc, useDateLine } from "./shared";

const UNIT: Record<Game["unitReviews"]["units"][number]["unit"], Key> = {
  defense: "unit_defense", midfield: "unit_midfield", attack: "unit_attack",
};

function Evs({ ev }: { ev: string[] }) {
  const { halfRef } = useI18n();
  return ev.length ? <div className="evs">{ev.map((e, i) => <span key={i}>{halfRef(e)}</span>)}</div> : null;
}

export function UnitReview({ game: g }: { game: Game }) {
  const { t } = useI18n();
  const { manifest } = useSite();
  const dateLine = useDateLine(g);
  const count = useNoteCounts(g.slug);
  const R = g.unitReviews;

  return (
    <div className="pg-units">
      <header className="top">
        <div className="wrap">
          <span className="eyebrow">{t("unitReview")} · {dateLine}</span>
          <h1>{manifest.us} {g.score.us}–{g.score.them} <span>{g.opponent}</span></h1>
          <p><T t={R.intro} /></p>
        </div>
      </header>

      <main className="wrap">
        <Toc items={R.units.map(u => [`unit-${u.unit}`, t(UNIT[u.unit])])} />

        {R.units.map(u => {
          const anchor = `section:units/${u.unit}`;
          return (
            <section key={u.unit} className="sec" id={`unit-${u.unit}`}>
              <div className="sec-head">
                <span className="eyebrow mono">{u.positions}</span>
                <div className="row">
                  <h2>{t(UNIT[u.unit])}</h2>
                  <NoteButton slug={g.slug} anchor={anchor} label={t(UNIT[u.unit])} count={count(anchor)} />
                </div>
                <p className="lede"><T t={u.summary} /></p>
              </div>

              <div className="pn">
                <div className="col plus">
                  <h3>{t("wentWell")}</h3>
                  <ul>{u.positives.map((p, i) => <li key={i}><T t={p.text} /><Evs ev={p.ev} /></li>)}</ul>
                </div>
                <div className="col minus">
                  <h3>{t("wentWrong")}</h3>
                  <ul>{u.negatives.map((p, i) => <li key={i}><T t={p.text} /><Evs ev={p.ev} /></li>)}</ul>
                </div>
              </div>

              <div className="improve">
                <h3>{t("howToImprove")}</h3>
                <ol>
                  {u.improvements.map((im, i) => (
                    <li key={i}>
                      <span className="area">{t(`area_${im.area}` as Key)}</span>
                      <div>
                        <h4><T t={im.title} /></h4>
                        <p><T t={im.detail} /></p>
                        <Evs ev={im.ev} />
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
