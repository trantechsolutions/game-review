import { T } from "../components/RichText";
import { NoteButton, useNoteCounts } from "../components/Notes";
import { useI18n, type Key } from "../i18n";
import { useEffect, useState } from "react";
import { useNotes } from "../notes";
import type { Game, Priority, PublicGame } from "../schema";
import { useSite } from "../site";
import { SecHead, Toc } from "./shared";

const PRI: Record<Priority, Key> = { high: "priHigh", med: "priMed", low: "priLow" };

function Pri({ p }: { p: Priority }) {
  const { t } = useI18n();
  return <span className={`pri ${p}`}>{t(PRI[p])}</span>;
}

function Evs({ ev }: { ev: string[] }) {
  const { halfRef } = useI18n();
  return ev.length ? <div className="evs">{ev.map((e, i) => <span key={i}>{halfRef(e)}</span>)}</div> : null;
}

/** The coaches' breakdown is in its own file, sealed with the coach-password key. */
export function useCoaches(slug: string) {
  const { contentKey } = useNotes();
  const { loadCoaches } = useSite();
  const [state, setState] = useState<{ coaches?: Game["coaches"]; error?: unknown }>({});
  useEffect(() => {
    if (!contentKey) { setState({}); return; }
    let live = true;
    loadCoaches(slug, contentKey).then(coaches => live && setState({ coaches }), error => live && setState({ error }));
    return () => { live = false; };
  }, [slug, contentKey, loadCoaches]);
  return { locked: !contentKey, ...state };
}

export function Coaches({ game }: { game: PublicGame }) {
  const { t } = useI18n();
  const { setLoginOpen } = useNotes();
  const { locked, coaches, error } = useCoaches(game.slug);
  if (locked) {
    return (
      <div className="status wrap locked">
        <span className="eyebrow">{t("coachesBreakdown")}</span>
        <h1>{t("coachesOnly")}</h1>
        <p className="sub">{t("coachesOnlyHelp")}</p>
        <button type="button" className="btn-solid" onClick={() => setLoginOpen(true)}>{t("signIn")}</button>
      </div>
    );
  }
  if (error) return <div className="status wrap" role="status"><p>{t("loadFailed")}</p></div>;
  if (!coaches) return <div className="status wrap" role="status"><p>{t("loading")}</p></div>;
  return <CoachesBody game={{ ...game, coaches }} />;
}

function CoachesBody({ game: g }: { game: Game }) {
  const { manifest } = useSite();
  const { t, tx } = useI18n();
  const count = useNoteCounts(g.slug);
  const C = g.coaches;

  return (
    <div className="pg-coaches">
      <header className="top">
        <div className="wrap">
          <span className="eyebrow"><T t={C.eyebrow} /></span>
          <h1><T t={C.title} />{C.titleAccent ? <> <span><T t={C.titleAccent} /></span></> : null}</h1>
          <p><T t={C.intro} /></p>
          <div className="meta">{C.meta.map((m, i) => <span key={i}><T t={m} /></span>)}</div>
        </div>
      </header>

      <main className="wrap">
        <Toc items={[["priorities", t("priorities")], ["thirds", t("byThird")], ["units", t("byUnit")], ["plan", t("trainingPlan")], ["clips", t("clips")]]} />

        <section className="sec" id="priorities">
          <SecHead g={g} page="coaches" id="priorities" eyebrow={<T t={C.priorities.eyebrow} />} title={tx(C.priorities.title)} count={count} />
          <ol className="top3">
            {C.priorities.items.map((p, i) => (
              <li key={i}><span className="n">{t("priority", { n: i + 1 })}</span><h3><T t={p.title} /></h3><p><T t={p.body} /></p></li>
            ))}
          </ol>
        </section>

        <section className="sec" id="thirds">
          <SecHead g={g} page="coaches" id="thirds" eyebrow={<T t={C.thirds.eyebrow} />} title={tx(C.thirds.title)} sub={<T t={C.thirds.sub} />} count={count} />
          <div className="pitch-scroll">
            <div className="pitch" role="img" aria-label={t("pitchLabel")}>
              <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
                <rect className="pl" x="20" y="20" width="960" height="480" />
                <line className="pl" x1="500" y1="20" x2="500" y2="500" />
                <circle className="pl" cx="500" cy="260" r="62" />
                <circle className="pl-dot" cx="500" cy="260" r="4" />
                <rect className="pl" x="20" y="135" width="132" height="250" />
                <rect className="pl" x="20" y="200" width="46" height="120" />
                <rect className="pl" x="848" y="135" width="132" height="250" />
                <rect className="pl" x="934" y="200" width="46" height="120" />
                <line className="pl-third" x1="340" y1="20" x2="340" y2="500" />
                <line className="pl-third" x1="660" y1="20" x2="660" y2="500" />
              </svg>
              <div className="zones">
                {C.thirds.zones.map((z, i) => (
                  <div key={i} className="zone">
                    <div className="zone-top">
                      <span className="eyebrow"><T t={z.name} /></span>
                      <h3><T t={z.title} /></h3>
                      <Pri p={z.pri} />
                      <p className="z-pri"><T t={z.text} /></p>
                    </div>
                    <div className="counts">{z.counts.map((c, j) => <span key={j}><T t={c} /></span>)}</div>
                  </div>
                ))}
              </div>
              <span className="attack-dir">{t("attackDir", { us: manifest.us })}</span>
            </div>
          </div>

          {C.thirds.blocks.map((b, i) => {
            const anchor = `section:coaches/third-${i + 1}`;
            return (
              <div key={i} className="block">
                <div className="block-intro">
                  <span className="eyebrow"><T t={b.name} /></span>
                  <h3><T t={b.title} /></h3>
                  <NoteButton slug={g.slug} anchor={anchor} label={tx(b.name)} count={count(anchor)} />
                  <p><T t={b.intro} /></p>
                  <div className="keep">
                    <span className="eyebrow">{t("keepDoing")}</span>
                    <ul>{b.keep.map((k, j) => <li key={j}><T t={k} /></li>)}</ul>
                  </div>
                </div>
                <ul className="fixes">
                  {b.fixes.map((f, j) => (
                    <li key={j} className="fix">
                      <Pri p={f.pri} />
                      <div className="fix-body">
                        <h4><T t={f.title} /></h4>
                        <p><T t={f.body} /></p>
                        {f.coach ? <p><b>{t("coachIt")}</b> <T t={f.coach} /></p> : null}
                        <Evs ev={f.ev} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="sec" id="units">
          <SecHead g={g} page="coaches" id="units" eyebrow={<T t={C.units.eyebrow} />} title={tx(C.units.title)} sub={<T t={C.units.sub} />} count={count} />
          <div className="units">
            {C.units.items.map((u, i) => {
              const anchor = `section:coaches/unit-${i + 1}`;
              return (
                <article key={i} className="unit">
                  <div className="unit-head">
                    <h3><T t={u.name} /></h3>
                    <span className="pos">{u.pos}</span>
                    <NoteButton slug={g.slug} anchor={anchor} label={tx(u.name)} count={count(anchor)} />
                  </div>
                  <p className="verdict"><T t={u.verdict} /></p>
                  <ul>{u.items.map((it, j) => <li key={j}><Pri p={it.pri} /><span><T t={it.text} /></span><Evs ev={it.ev} /></li>)}</ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="sec" id="plan">
          <SecHead g={g} page="coaches" id="plan" eyebrow={<T t={C.plan.eyebrow} />} title={tx(C.plan.title)} sub={<T t={C.plan.sub} />} count={count} />
          <ol className="plan">
            {C.plan.sessions.map((s, i) => (
              <li key={i} className="session">
                <div className="slot"><b><T t={s.slot} /></b><span><T t={s.duration} /></span></div>
                <div className="s-body">
                  <h3><T t={s.title} /></h3>
                  <ul>{s.items.map((it, j) => <li key={j}><T t={it} /></li>)}</ul>
                  {s.fixes ? <p className="fixes-ref"><T t={s.fixes} /></p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="sec" id="clips">
          <SecHead g={g} page="coaches" id="clips" eyebrow={<T t={C.clips.eyebrow} />} title={tx(C.clips.title)} sub={<T t={C.clips.sub} />} count={count} />
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t("colTopic")}</th><th>{t("colMoment")}</th><th>{t("clips")}</th><th>{t("colAt")}</th><th>{t("colUnit")}</th></tr></thead>
              <tbody>
                {C.clips.rows.map((r, i) => (
                  <tr key={i}><td><T t={r.topic} /></td><td><T t={r.moment} /></td><td className="mono">{r.file}</td><td className="mono">{r.at}</td><td><T t={r.unit} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="foot">{C.footer.map((p, i) => <p key={i}><T t={p} /></p>)}</footer>
      </main>
    </div>
  );
}
