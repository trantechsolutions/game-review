// Scorekeeper mode (#/keep): its own password, its own screens. Set the game up step by step, then log it
// the way the possession flows: tap the next player on the ball (a pass, a ball won or lost), swipe a player
// for a shot, cross or clearance, and use Out and Infractions for the whistles. Phone first; a tablet adds
// the log and the numbers beside the pitch.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { FormationThumb, GoalMouth, LinePicker, ShotSpot, type GoalPick } from "../components/KeepPickers";
import { Pitch, place, useDrag, usePortrait, type Drop } from "../components/KeepPitch";
import { VoiceBox, type Heard } from "../components/VoiceBox";
import { parseVoice, runVoice } from "../lib/voice";
import { formatDate, useI18n, type Key } from "../i18n";
import { BadKeeperPassword, KeeperProvider, useKeeper } from "../keeper";
import {
  clockAt, clockStr, lastUndoable, newId, placeAll, replay, restartFor, shapeOf, SHAPES, slugFor, stats, tapEvent,
  type Actor, type Ev, type EvFields, type FeedItem, type KeepState, type Side,
} from "../lib/keeplog";
import { candidates, POSITIONS, type RosterPlayer } from "../lib/positions";
import { upcoming } from "../lib/schedule";
import { sec } from "../lib/time";
import type { KeepEntry, KeepSetup, KeepType, ScheduledGame } from "../schema";

// ---------- Routing inside #/keep ----------

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const on = () => setH(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}
const go = (path: string) => { location.hash = `#/keep${path}`; };

export function KeepApp() {
  return <KeeperProvider><KeepRoutes /></KeeperProvider>;
}

function KeepRoutes() {
  const k = useKeeper();
  const { t } = useI18n();
  const hash = useHash();
  const portrait = usePortrait();
  useEffect(() => { document.title = t("kp_title"); }, [t]);
  if (portrait) return <TurnSideways />;
  if (!k.hasKeys) return <KeepGate />;
  if (!k.roster) return <div className="status wrap kp-wrap" role="status"><p>{t("kp_needConnection")}</p><button className="btn-line" onClick={k.signOut}>{t("signOut")}</button></div>;
  const parts = hash.replace(/^#\/keep\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "new") return <Setup slug={null} />;
  if (parts[0] === "g" && parts[1]) return parts[2] === "setup" ? <Setup slug={parts[1]} /> : <Live slug={parts[1]} />;
  return <Home />;
}

/** Scorekeeper mode is landscape only. A full-screen page can also lock the rotation (Android). */
function TurnSideways() {
  const { t } = useI18n();
  const full = async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch { /* not supported: turning the phone is enough */ }
  };
  return (
    <main className="kp-rotate" role="alert">
      <span className="icon" aria-hidden="true">📱</span>
      <h1>{t("kp_rotateTitle")}</h1>
      <p className="sub">{t("kp_rotateNote")}</p>
      {document.fullscreenEnabled ? <button type="button" className="btn-solid" onClick={full}>{t("kp_fullscreen")}</button> : null}
    </main>
  );
}

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return <button type="button" className="btn-line" lang={lang === "en" ? "es" : "en"} aria-label={t("languageLabel")} onClick={() => setLang(lang === "en" ? "es" : "en")}>{t("language")}</button>;
}

// ---------- Sign in ----------

function KeepGate() {
  const { t } = useI18n();
  const k = useKeeper();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const pw = String(new FormData(ev.currentTarget).get("pw")).trim();
    setBusy(true); setMsg(t("checking"));
    try { await k.signIn(pw); }
    catch (err) { setMsg(err instanceof BadKeeperPassword ? t("kp_badPassword") : t("loadFailed")); setBusy(false); }
  }
  return (
    <main className="gate">
      <form onSubmit={onSubmit}>
        <p className="eyebrow">{t("kp_eyebrow")}</p>
        <h1>{t("kp_titleA")} <span>{t("kp_titleB")}</span></h1>
        <div className="field">
          <label htmlFor="kp-pw">{t("kp_password")}</label>
          <input id="kp-pw" name="pw" type={show ? "text" : "password"} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} required autoFocus />
        </div>
        <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> {t("showPassword")}</label>
        <button type="submit" className="btn-solid" disabled={busy}>{t("open")}</button>
        <p className="msg" role="alert">{msg}</p>
        <p className="sub">{t("kp_gateNote")}</p>
        <div className="kp-row"><LangToggle /><a className="btn-line" href="#/">{t("kp_toFilm")}</a></div>
      </form>
    </main>
  );
}

// ---------- Shared bits ----------

const numberOf = (players: RosterPlayer[], name: string) => players.find(p => p.name === name)?.number ?? null;
const firstName = (name: string) => name.split(" ")[0];
const shortName = (name: string) => { const [f, ...r] = name.split(" "); return r.length ? `${f} ${r[r.length - 1][0]}.` : f; };
const initials = (name: string) => name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const tokenText = (players: RosterPlayer[], name: string) => { const n = numberOf(players, name); return n != null ? String(n) : initials(name); };
const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };

function SyncBadge() {
  const { sync } = useKeeper();
  const { t } = useI18n();
  const label = sync.state === "sending" ? t("kp_syncSending")
    : sync.state === "offline" ? t("kp_syncOffline", { n: sync.pending })
    : sync.state === "error" ? t("kp_syncError", { n: sync.pending })
    : sync.state === "expired" ? t("kp_syncExpired", { n: sync.pending })
    : sync.pending ? t("kp_syncWaiting", { n: sync.pending }) : t("kp_syncOk");
  return <span className={`kp-sync ${sync.state}${sync.pending ? " pending" : ""}`} title={sync.error || undefined} role="status">{label}</span>;
}

function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="kp-scrim" onClick={onClose}>
      <div className="kp-sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} onClick={e => e.stopPropagation()}>
        <div className="kp-sheet-head"><h2>{title}</h2><button type="button" className="btn-line" onClick={onClose}>{t("kp_close")}</button></div>
        {children}
      </div>
    </div>
  );
}

/** A full-screen step: a prompt, the picture or buttons for it, and a way back. */
function Step({ title, onBack, backLabel, next, children }: { title: string; onBack: () => void; backLabel?: string; next?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="kp-step" role="dialog" aria-modal="true" aria-label={title}>
      <header className="kp-step-head">
        <button type="button" className="btn-line" onClick={onBack}>{backLabel ?? t("kp_back")}</button>
        <h2>{title}</h2>
        <span className="kp-step-next">{next}</span>
      </header>
      <div className="kp-step-body">{children}</div>
    </div>
  );
}

const useGameState = (slug: string): KeepState => {
  const k = useKeeper();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => replay(k.entries(slug)), [k.version, slug]);
};

// ---------- Home: the games on this device ----------

function Home() {
  const k = useKeeper();
  const { t, locale } = useI18n();
  const [del, setDel] = useState<{ slug: string; label: string } | null>(null);
  useEffect(() => { k.refresh(); }, [k.refresh]);
  const rows = k.games.map(slug => ({ slug, s: replay(k.entries(slug)) })).filter(r => r.s.setup);
  return (
    <main className="kp-wrap kp-home">
      <header className="kp-top">
        <h1>{t("kp_titleA")} <span>{t("kp_titleB")}</span></h1>
        <div className="kp-row"><SyncBadge /><LangToggle /><button type="button" className="btn-line" onClick={k.signOut}>{t("signOut")}</button></div>
      </header>
      <button type="button" className="btn-solid kp-new" onClick={() => go("/new")}>{t("kp_newGame")}</button>
      {rows.length ? (
        <ul className="kp-games">
          {rows.map(({ slug, s }) => (
            <li key={slug}>
              <a href={`#/keep/g/${encodeURIComponent(slug)}`}>
                <span className="eyebrow">{formatDate(s.setup!.date, locale, "short")}{s.setup!.time ? ` · ${s.setup!.time}` : ""} · {s.setup!.format}v{s.setup!.format}</span>
                <span className="kp-g-line"><b>{k.roster!.us} {s.score.us}–{s.score.them} {s.setup!.opponent}</b><span className="muted">{t(`kp_phase_${s.phase}`)}</span></span>
              </a>
              <button type="button" className="btn-line kp-del" aria-label={`${t("kp_delete")}: ${s.setup!.opponent}`}
                onClick={() => setDel({ slug, label: `${formatDate(s.setup!.date, locale, "short")} · ${k.roster!.us} ${s.score.us}–${s.score.them} ${s.setup!.opponent}` })}>{t("kp_delete")}</button>
            </li>
          ))}
        </ul>
      ) : <p className="sub">{t("kp_noGames")}</p>}
      <p className="sub">{t("kp_homeSaved")} {t("kp_homeNote")}</p>
      {del ? (
        <Sheet title={t("kp_deleteQ")} onClose={() => setDel(null)}>
          <p><b>{del.label}</b></p>
          <p className="sub">{t("kp_deleteNote")}</p>
          <div className="kp-row">
            <button type="button" className="btn-line" onClick={() => setDel(null)}>{t("kp_cancel")}</button>
            <button type="button" className="btn-solid kp-danger" onClick={() => { k.forget(del.slug); setDel(null); }}>{t("kp_delete")}</button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}

// ---------- Setup: one question at a time ----------

interface SlotPick { pos: string; player: string | null }
type SetupStep = "details" | "players" | "level" | "minutes" | "side" | "formation" | "starters";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Setup({ slug }: { slug: string | null }) {
  const k = useKeeper();
  const { t, locale } = useI18n();
  const players = k.roster!.players;
  const existing = slug ? replay(k.entries(slug)).setup : null;
  const scheduled = useMemo(() => (slug ? [] : upcoming(k.roster!.schedule ?? [], today())), [slug, k.roster]);
  const previous = useMemo(() => k.games.filter(g => g !== slug).map(g => replay(k.entries(g)).setup).find(Boolean) ?? null, [k.games, slug, k]);
  const seed = existing ?? previous;

  const [step, setStep] = useState<SetupStep>("details");
  const [opponent, setOpponent] = useState(existing?.opponent ?? "");
  const [date, setDate] = useState(existing?.date ?? today());
  const [time, setTime] = useState(existing?.time ?? "");
  const [home, setHome] = useState<"home" | "away" | "unknown">(existing ? (existing.home == null ? "unknown" : existing.home ? "home" : "away") : "unknown");
  const [eventId, setEventId] = useState(existing?.eventId);
  const fromSchedule = (g: ScheduledGame) => {
    setOpponent(g.opponent); setDate(g.date); setTime(g.time);
    setHome(g.home == null ? "unknown" : g.home ? "home" : "away");
    setEventId(g.eventId); setErr("");
  };
  const [format, setFormat] = useState(seed?.format ?? 11);
  const [level, setLevel] = useState<"beginner" | "advanced">(seed?.level ?? "advanced");
  const [halfMin, setHalfMin] = useState(seed?.halfMin ?? 30);
  const [stopClock, setStopClock] = useState(seed?.stopClock ?? false);
  const [side, setSide] = useState<"left" | "right">(existing?.side ?? "left");
  const [formation, setFormation] = useState(shapeOf(seed?.format ?? 11, seed?.formation).id);
  const [slots, setSlots] = useState<SlotPick[]>(() => existing?.start.length
    ? existing.start.map(s => ({ ...s }))
    : shapeOf(seed?.format ?? 11, seed?.formation).slots.map(([pos]) => ({ pos, player: null })));
  const [sel, setSel] = useState<{ kind: "slot"; i: number } | { kind: "bench"; name: string } | null>(null);
  const [posSheet, setPosSheet] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const started = slug ? replay(k.entries(slug)).phase !== "pre" : false;

  const steps: SetupStep[] = ["details", "players", "level", "minutes", "side", ...(level === "advanced" ? ["formation", "starters"] as SetupStep[] : [])];
  const at = steps.indexOf(step);
  const back = () => (at > 0 ? setStep(steps[at - 1]) : go(slug ? `/g/${encodeURIComponent(slug)}` : ""));
  const next = () => {
    if (step === "details" && !opponent.trim()) { setErr(t("kp_needOpponent")); return; }
    setErr("");
    if (at < steps.length - 1) setStep(steps[at + 1]); else submit();
  };
  const reshape = (n: number, id: string) => {
    const placed = slots.map(s => s.player).filter((p): p is string => !!p);
    setSlots(shapeOf(n, id).slots.map(([pos], i) => ({ pos, player: placed[i] ?? null })));
  };
  const pickFormat = (n: number) => { setFormat(n); const id = SHAPES[n][0].id; setFormation(id); reshape(n, id); };
  const pickFormation = (id: string) => { setFormation(id); reshape(format, id); };
  const autoFill = () => {
    const nextSlots = slots.map(s => ({ ...s }));
    const used = new Set(nextSlots.map(s => s.player).filter(Boolean));
    for (const s of nextSlots) {
      if (s.player) continue;
      const c = candidates(s.pos, players).find(p => !used.has(p.name)) ?? players.find(p => !used.has(p.name));
      if (c) { s.player = c.name; used.add(c.name); }
    }
    setSlots(nextSlots);
  };
  const sameAsLast = () => {
    if (!previous?.start.length) return;
    setFormat(previous.format);
    setFormation(shapeOf(previous.format, previous.formation).id);
    setSlots(previous.start.map(s => ({ ...s })));
  };
  // Tap two spots to swap them; tap a spot and a bench player (either order) to put them there.
  const tapSlot = (i: number) => {
    if (sel?.kind === "slot" && sel.i === i) { setPosSheet(i); setSel(null); return; }
    if (sel?.kind === "slot") {
      const j = sel.i;
      setSlots(prev => { const n = prev.map(s => ({ ...s })); [n[i].player, n[j].player] = [n[j].player, n[i].player]; return n; });
      setSel(null); return;
    }
    if (sel?.kind === "bench") { const name = sel.name; setSlots(prev => prev.map((s, j) => (j === i ? { ...s, player: name } : s))); setSel(null); return; }
    setSel({ kind: "slot", i });
  };
  const tapBench = (name: string) => {
    if (sel?.kind === "slot") { const i = sel.i; setSlots(prev => prev.map((s, j) => (j === i ? { ...s, player: name } : s))); setSel(null); return; }
    setSel(sel?.kind === "bench" && sel.name === name ? null : { kind: "bench", name });
  };

  function submit() {
    const start = level === "advanced" ? slots.filter((s): s is { pos: string; player: string } => !!s.player).map(s => ({ pos: s.pos, player: s.player })) : [];
    let id = slug ?? slugFor(date, opponent.trim());
    if (!slug && k.games.includes(id)) { let n = 2; while (k.games.includes(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    const setup: KeepSetup = {
      slug: id, date, time, opponent: opponent.trim(), home: home === "unknown" ? null : home === "home",
      format, formation, side, halfMin, stopClock, level, start, ...(eventId ? { eventId } : {}),
    };
    k.append(id, { id: newId(), at: Date.now(), k: "setup", setup });
    go(`/g/${encodeURIComponent(id)}`);
  }

  const last = at === steps.length - 1;
  const nextBtn = <button type="button" className="btn-solid kp-next" onClick={next}>{last ? (slug ? t("kp_saveSetup") : t("kp_startGame")) : t("kp_nextStep")}</button>;
  const title = {
    details: slug ? t("kp_editSetup") : t("kp_newGame"), players: t("kp_qPlayers"), level: t("kp_qLevel"), minutes: t("kp_qMinutes"),
    side: t("kp_qSide"), formation: t("kp_qFormation"), starters: t("kp_qStarters"),
  }[step];
  const placedSlots = placeAll(slots.map((s, i) => ({ ...s, i })), { format, formation });
  const bench = players.filter(p => !slots.some(s => s.player === p.name));

  return (
    <main className="kp-wrap kp-setup">
      <header className="kp-top">
        <button type="button" className="btn-line" onClick={back}>‹ {t("kp_back")}</button>
        <h1>{title}</h1>
        {nextBtn}
      </header>
      <p className="eyebrow">{t("kp_stepOf", { n: at + 1, of: steps.length })}</p>

      {step === "details" && scheduled.length ? (
        <section className="kp-sched" aria-label={t("kp_fromSchedule")}>
          <p className="eyebrow">{t("kp_fromSchedule")} <span className="muted">· {t("kp_scheduleHint")}</span></p>
          <div className="kp-sched-list">
            {scheduled.map(g => (
              <button key={g.eventId} type="button" className={`kp-sched-btn${eventId === g.eventId ? " on" : ""}`} aria-pressed={eventId === g.eventId} onClick={() => fromSchedule(g)}>
                <span className="eyebrow">{g.date === today() ? t("kp_today") : formatDate(g.date, locale, "short")}{g.time ? ` · ${g.time}` : ""}{g.home === false ? ` · ${t("awayShort")}` : g.home ? ` · ${t("homeShort")}` : ""}</span>
                <b>{g.opponent ? `${t("vs")} ${g.opponent}` : g.title}</b>
                {g.location ? <span className="muted">{g.location}</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "details" ? (
        <section className="kp-form">
          <label>{t("kp_opponent")}<input value={opponent} onChange={e => setOpponent(e.target.value)} autoComplete="off" required autoFocus={!slug} /></label>
          <label>{t("kp_date")}<input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!!slug} /></label>
          <label>{t("kp_kickoff")}<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          <label>{t("kp_venue")}
            <select value={home} onChange={e => setHome(e.target.value as typeof home)}>
              <option value="home">{t("homeShort")}</option><option value="away">{t("awayShort")}</option><option value="unknown">{t("kp_unknown")}</option>
            </select>
          </label>
        </section>
      ) : null}

      {step === "players" ? (
        <div className="kp-tiles">
          {[11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => (
            <button key={n} type="button" className={`kp-tile${format === n ? " on" : ""}`} aria-pressed={format === n} onClick={() => pickFormat(n)}><b>{n}v{n}</b></button>
          ))}
        </div>
      ) : null}

      {step === "level" ? (
        <div className="kp-tiles two">
          {(["beginner", "advanced"] as const).map(l => (
            <button key={l} type="button" className={`kp-tile tall${level === l ? " on" : ""}`} aria-pressed={level === l} onClick={() => setLevel(l)}>
              <b>{t(`kp_level_${l}`)}</b><span>{t(`kp_level_${l}Sub`)}</span><small>{t(`kp_level_${l}Note`)}</small>
            </button>
          ))}
        </div>
      ) : null}

      {step === "minutes" ? (
        <>
          <div className="kp-tiles">
            {[20, 25, 30, 35, 40, 45].map(m => (
              <button key={m} type="button" className={`kp-tile${halfMin === m ? " on" : ""}`} aria-pressed={halfMin === m} onClick={() => setHalfMin(m)}><b>{m}</b><span>{t("kp_min")}</span></button>
            ))}
          </div>
          <div className="kp-form">
            <label>{t("kp_otherLength")}<input type="number" inputMode="numeric" min={1} max={60} value={halfMin} onChange={e => setHalfMin(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /></label>
          </div>
          <label className="check kp-toggle"><input type="checkbox" checked={stopClock} onChange={e => setStopClock(e.target.checked)} /> {t("kp_stopClock")}</label>
          <p className="sub">{t("kp_stopClockNote")}</p>
        </>
      ) : null}

      {step === "side" ? (
        <>
          <div className="kp-sides">
            {(["left", "right"] as const).map(sd => (
              <button key={sd} type="button" className={`kp-side-pick${side === sd ? " on" : ""}`} aria-pressed={side === sd} onClick={() => setSide(sd)}>
                <svg viewBox="0 0 50 64" aria-hidden="true">
                  <rect className="ln" x="1" y="1" width="48" height="62" />
                  {sd === "left" ? <><rect className="ln" x="1" y="16" width="14" height="32" /><rect className="ln" x="1" y="25" width="5" height="14" /></>
                    : <><rect className="ln" x="35" y="16" width="14" height="32" /><rect className="ln" x="44" y="25" width="5" height="14" /></>}
                </svg>
                <b>{t(`kp_side_${sd}`)}</b>
              </button>
            ))}
          </div>
          <p className="sub">{t("kp_sideNote")}</p>
        </>
      ) : null}

      {step === "formation" ? (
        <div className="kp-tiles">
          {SHAPES[format].map(f => (
            <button key={f.id} type="button" className={`kp-tile form${formation === f.id ? " on" : ""}`} aria-pressed={formation === f.id} onClick={() => pickFormation(f.id)}>
              <FormationThumb slots={f.slots} /><b>{f.id}</b>
            </button>
          ))}
        </div>
      ) : null}

      {step === "starters" ? (
        <>
          <div className="kp-row kp-lineup-tools">
            <span className="eyebrow">{t("kp_startingLineup")} · {slots.filter(s => s.player).length}/{slots.length}</span>
            <button type="button" className="btn-line" onClick={autoFill}>{t("kp_autoFill")}</button>
            {previous?.start.length ? <button type="button" className="btn-line" onClick={sameAsLast}>{t("kp_sameAsLast")}</button> : null}
            <button type="button" className="btn-line" onClick={() => setSlots(slots.map(s => ({ ...s, player: null })))}>{t("kp_clear")}</button>
          </div>
          <div className="kp-bench setup" aria-label={t("kp_bench")}>
            {bench.map(p => (
              <button key={p.name} type="button" className={`kp-pill bench${sel?.kind === "bench" && sel.name === p.name ? " sel" : ""}`} onClick={() => tapBench(p.name)}>
                <span className="num">{p.number ?? initials(p.name)}</span>{firstName(p.name)}
              </button>
            ))}
          </div>
          <p className="sub">{t("kp_swapHint")}</p>
          {started ? <p className="sub kp-warn">{t("kp_editAfterKickoff")}</p> : null}
          <Pitch label={t("kp_startingLineup")}>
            {placedSlots.map(sl => (
              <button key={sl.i} type="button" className={`kp-pill us slot${sl.player ? "" : " empty"}${sel?.kind === "slot" && sel.i === sl.i ? " sel" : ""}`} style={place(sl.x, sl.y)} onClick={() => tapSlot(sl.i)}>
                <span className="num">{sl.player ? tokenText(players, sl.player) : "+"}</span>{sl.player ? firstName(sl.player) : ""}<i>{sl.pos}</i>
              </button>
            ))}
          </Pitch>
        </>
      ) : null}

      <p className="msg" role="alert">{err}</p>
      <div className="kp-row">{nextBtn}</div>

      {posSheet != null ? (
        <Sheet title={`${slots[posSheet].player ?? ""} · ${t("kp_position")}`} onClose={() => setPosSheet(null)}>
          <div className="kp-chips">
            {Object.keys(POSITIONS).map(p => (
              <button key={p} type="button" className={`kp-chip${slots[posSheet].pos === p ? " on" : ""}`}
                onClick={() => { setSlots(prev => prev.map((s, j) => (j === posSheet ? { ...s, pos: p } : s))); setPosSheet(null); }}>{p}</button>
            ))}
          </div>
          {slots[posSheet].player ? <button type="button" className="btn-line" onClick={() => { setSlots(prev => prev.map((s, j) => (j === posSheet ? { ...s, player: null } : s))); setPosSheet(null); }}>{t("kp_emptySpot")}</button> : null}
        </Sheet>
      ) : null}
    </main>
  );
}

// ---------- Live ----------

type Infraction = "Foul" | "Handball" | "Offside" | "Yellow" | "Red" | "Own goal";
type ShotFlow = { k: "shot"; a: Actor; step: "from" | "to" | "result" | "assist"; x?: number; y?: number; goal?: GoalPick };
type OutFlow = { k: "out"; step: "line" | "taker" | "type"; x?: number; y?: number; edge?: "touch" | "ours" | "theirs"; taker?: Actor; afterShot?: boolean };
type InfFlow = { k: "inf"; step: "what" | "who" | "restart"; what?: Infraction; who?: Actor };
type Flow = { k: "kickoff"; a: Actor } | ShotFlow | OutFlow | InfFlow;

const ZONES: KeepType[] = ["Shot", "Cross", "Clearance"];
const INFRACTIONS: Infraction[] = ["Foul", "Handball", "Offside", "Yellow", "Red", "Own goal"];
const INF_ICON: Record<Infraction, string> = { Foul: "⚠", Handball: "✋", Offside: "⚑", Yellow: "▮", Red: "▮", "Own goal": "⚽" };
const whoFields = (a: Actor) => (a.t === "D" ? { t: "D" as const, ...(a.player ? { player: a.player } : {}) } : { t: "O" as const, opp: a.opp });

function Live({ slug }: { slug: string }) {
  const k = useKeeper();
  const { t, ev: evName, lang } = useI18n();
  const s = useGameState(slug);
  const players = k.roster!.players;
  const [now, setNow] = useState(Date.now());
  const running = s.clock.since != null;
  const [flow, setFlow] = useState<Flow | null>(null);
  const [sheet, setSheet] = useState<{ kind: "player" | "bench"; name: string } | { kind: "clock" } | { kind: "stats" } | { kind: "lineup" } | { kind: "item"; item: FeedItem } | null>(null);
  const [toast, setToast] = useState<{ text: string; id: string } | null>(null);
  // Voice: the strip is remembered on this phone; what was heard is kept per game for tuning the phrases.
  const VOICE_ON = "dfc-keeper-voice-on", HEARD = `dfc-keeper-voice:${slug}`;
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem(VOICE_ON) === "1"; } catch { return false; } });
  const [heardLog, setHeardLog] = useState<Heard[]>(() => { try { return JSON.parse(localStorage.getItem(HEARD) ?? "[]"); } catch { return []; } });
  const [heardSheet, setHeardSheet] = useState(false);
  const [lineSel, setLineSel] = useState<{ kind: "on" | "bench"; name: string } | null>(null);
  const toggleVoice = () => { const v = !voiceOn; setVoiceOn(v); try { localStorage.setItem(VOICE_ON, v ? "1" : "0"); } catch { /* storage blocked */ } };

  useEffect(() => { k.refresh(); const i = setInterval(k.refresh, 20000); return () => clearInterval(i); }, [k.refresh]);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [running]);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(null), 3000); return () => clearTimeout(i); }, [toast]);
  // Keep the screen on while logging.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const get = () => { navigator.wakeLock?.request("screen").then(l => { lock = l; }, () => {}); };
    get();
    const vis = () => { if (document.visibilityState === "visible") get(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); lock?.release().catch(() => {}); };
  }, []);

  const drag = useDrag((src, d) => onDrop(src, d), src => onTap(src), src => onLong(src));
  if (!s.setup) return <div className="status wrap kp-wrap"><p>{t("notFound")}</p><a className="btn-line" href="#/keep">{t("kp_back")}</a></div>;
  const setup = s.setup;
  const beginner = setup.level === "beginner";
  const us = k.roster!.us, opp = setup.opponent;
  // As the scorekeeper sees it: our goal on their chosen side in the first half, the other side after.
  const flip = (setup.side === "right") !== (s.clock.h === 2 && s.phase !== "pre");

  const clockNow = () => clockAt(s.clock, Date.now());
  const moment = () => ({ h: s.clock.h, c: clockStr(clockNow()) });
  const base = () => ({ id: newId(), at: Date.now() });
  const log = (e: KeepEntry, text?: string) => {
    k.append(slug, e);
    buzz();
    if (text) setToast({ text, id: e.id });
  };
  const logEv = (f: EvFields, at = Date.now()) => {
    const e: KeepEntry = { id: newId(), at, k: "ev", ...moment(), ...f };
    k.append(slug, e);
    return e;
  };
  // Stop-clock mode: goals, cards and subs stop the clock until the scorekeeper restarts it.
  const stopIfNeeded = () => {
    if (setup.stopClock && s.clock.since != null) k.append(slug, { id: newId(), at: Date.now() + 5, k: "clock", h: s.clock.h, c: clockStr(clockNow()), run: false });
  };
  const undo = (id: string) => { k.append(slug, { ...base(), k: "void", ref: id }); buzz(); setToast(null); };

  const posOf = (name: string) => s.on.find(o => o.player === name)?.pos;
  const nameOf = (a: { t: Side; player?: string; opp?: "gk" | "pl" }): string => a.t === "D"
    ? (a.player ? firstName(a.player) : us)
    : (a.opp === "gk" ? t("kp_oppGk") : t("kp_oppPlayer"));

  // ---- What each gesture logs ----
  function tapActor(a: Actor) {
    if (s.phase === "done") return;
    const f = tapEvent(s, a);
    if (!f) return;
    if (f.type === "Kickoff" && (s.phase === "pre" || s.phase === "break")) { setFlow({ k: "kickoff", a }); return; }
    logEv(f);
    buzz();
  }
  function startKickoff(a: Actor) {
    const h = s.phase === "break" ? 2 : 1;
    const at = Date.now();
    k.append(slug, { id: newId(), at, k: "clock", h, c: "0:00", run: true });
    k.append(slug, { id: newId(), at: at + 1, k: "ev", h, c: "0:00", type: "Kickoff", ...whoFields(a) });
    buzz();
    setFlow(null);
  }
  const actorFrom = (src: string): Actor | null => {
    const [kind, ...rest] = src.split(":");
    const name = rest.join(":");
    if (kind === "p") return { t: "D", player: name };
    if (kind === "us") return { t: "D" };
    if (kind === "opp") return { t: "O", opp: name as "gk" | "pl" };
    return null;
  };
  function onTap(src: string) {
    if (src.startsWith("b:")) { setSheet({ kind: "bench", name: src.slice(2) }); return; }
    const a = actorFrom(src);
    if (a) tapActor(a);
  }
  function onLong(src: string) {
    if (src.startsWith("p:")) setSheet({ kind: "player", name: src.slice(2) });
  }
  function onDrop(src: string, d: Drop) {
    if (src.startsWith("b:")) {
      if (d.kind === "token" && d.id.startsWith("p:")) sub(d.id.slice(2), src.slice(2));
      else setToast({ text: t("kp_dropOnPlayer"), id: "" });
      return;
    }
    const a = actorFrom(src);
    if (!a || d.kind !== "token" || !d.id.startsWith("zone:") || s.phase === "pre" || s.phase === "done") return;
    const zone = d.id.slice(5) as KeepType;
    if (zone === "Shot") { setFlow({ k: "shot", a, step: "from" }); return; }
    logEv({ type: zone, ...whoFields(a) });
    buzz();
  }
  function sub(off: string, on: string) {
    log({ ...base(), k: "sub", ...moment(), off, on }, t("kp_subDone", { on: shortName(on), off: shortName(off) }));
    stopIfNeeded();
  }
  /** Two players on the field trade positions (two position changes at the same moment). */
  function swap(a: string, b: string) {
    const pa = posOf(a), pb = posOf(b);
    if (!pa || !pb) return;
    const at = Date.now(), m = moment();
    k.append(slug, { id: newId(), at, k: "move", ...m, player: a, pos: pb });
    const second: KeepEntry = { id: newId(), at: at + 1, k: "move", ...m, player: b, pos: pa };
    log(second, t("kp_swapDone", { a: shortName(a), b: shortName(b), pa: pb, pb: pa }));
  }
  // The lineup sheet: tap two on the field to swap, one on the field and one on the bench to sub,
  // or the same player twice for their positions.
  function tapLine(kind: "on" | "bench", name: string) {
    const cur = lineSel;
    if (!cur) { setLineSel({ kind, name }); return; }
    setLineSel(null);
    if (cur.name === name) { if (kind === "on") setSheet({ kind: "player", name }); return; }
    if (cur.kind === "on" && kind === "on") swap(cur.name, name);
    else if (cur.kind !== kind) sub(cur.kind === "on" ? cur.name : name, cur.kind === "bench" ? cur.name : name);
    else setLineSel({ kind, name });
  }

  // ---- The shot ----
  function finishShot(f: ShotFlow, result: "goal" | "saved" | "caught" | "blocked" | "off" | "post", assist?: string) {
    logEv({
      type: result === "goal" ? "Goal" : "Shot", ...whoFields(f.a), result,
      on: result === "goal" || result === "saved" || result === "caught",
      ...(f.x != null && f.y != null ? { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10 } : {}),
      ...(f.goal && result !== "blocked" ? { goal: [f.goal.u, f.goal.v] as [number, number] } : {}),
      ...(assist ? { assist } : {}),
    });
    buzz();
    if (result === "goal") stopIfNeeded();
    // A shot that missed or was blocked usually ends with the ball out: mark where (or skip if it stayed in).
    setFlow(result === "off" || result === "post" || result === "blocked" ? { k: "out", step: "line", afterShot: true } : null);
  }
  // The assist to suggest: whoever passed to the scorer, if that was the last thing before the shot.
  const lastPasserTo = (name?: string) => {
    const p = [...s.feed].reverse().find((e): e is Ev => e.k === "ev");
    return name && p?.type === "Pass" && p.to === name ? p.player : undefined;
  };

  // ---- Out of bounds ----
  function pickTaker(f: OutFlow, taker: Actor) {
    const type = restartFor(f.edge!, taker.t);
    if (type === "Corner" || type === "Goal kick") setFlow({ ...f, taker, step: "type" });
    else finishOut(f, taker);
  }
  function finishOut(f: OutFlow, taker: Actor, via?: "pass" | "cross" | "long") {
    logEv({ type: restartFor(f.edge!, taker.t), ...whoFields(taker), x: f.x!, y: f.y!, ...(via ? { via } : {}) });
    buzz();
    setFlow(null);
  }
  function illegalThrow(e: Ev) {
    const at = Date.now();
    logEv({ type: "Illegal throw-in", t: e.t, ...(e.player ? { player: e.player } : {}), ...(e.opp ? { opp: e.opp } : {}) }, at);
    const other: Side = e.t === "D" ? "O" : "D";
    logEv({ type: "Throw-in", t: other, ...(other === "O" ? { opp: "pl" as const } : {}), ...(e.x != null && e.y != null ? { x: e.x, y: e.y } : {}) }, at + 1);
    buzz();
  }

  // ---- Infractions ----
  function finishInf(what: Infraction, who: Actor, restart?: "Free kick" | "Penalty") {
    const at = Date.now();
    if (what === "Own goal") {
      // The goal goes to the other side; whoever put it in stays named.
      logEv(who.t === "D" ? { type: "Goal", t: "O", og: true, ...(who.player ? { player: who.player } : {}) } : { type: "Goal", t: "D", og: true, opp: who.opp }, at);
      stopIfNeeded();
    } else {
      logEv({ type: what, ...whoFields(who) }, at);
      if (what === "Yellow" || what === "Red") stopIfNeeded();
      const kick = what === "Offside" ? "Free kick" : restart;
      if (kick) {
        const other: Side = who.t === "D" ? "O" : "D";
        logEv({ type: kick, t: other, ...(other === "O" ? { opp: "pl" as const } : {}) }, at + 1);
      }
    }
    buzz();
    setFlow(null);
  }
  function pickInfWho(f: InfFlow, who: Actor) {
    if (f.what === "Foul" || f.what === "Handball") setFlow({ ...f, who, step: "restart" });
    else finishInf(f.what!, who);
  }

  // ---- Voice: a dictated line becomes the same entries the taps make ----
  const entryText = (e: KeepEntry): string => {
    if (e.k === "ev" || e.k === "sub" || e.k === "move") return itemText(e as FeedItem);
    if (e.k === "clock") return e.run ? `▶ ${t("kp_clockTitle")}` : `❚❚ ${t("kp_clockTitle")}`;
    if (e.k === "end") return e.h === 1 ? t("kp_endHalf") : t("kp_endGame");
    if (e.k === "void") return t("kp_undo");
    return "";
  };
  function onLine(text: string, test: boolean) {
    const p = parseVoice(text, { players, on: s.on });
    const steps = p.cmds.length ? runVoice(k.entries(slug), p.cmds, Date.now()) : [];
    const said = [...steps.map(st => (st.ok ? st.entries.map(entryText).filter(Boolean).join(", ") : `✗ ${st.note}`)), ...(p.error ? [`✗ ${p.error}`] : [])].join(" · ");
    const ok = !p.error && steps.length > 0 && steps.every(st => st.ok);
    if (!test) for (const st of steps) for (const e of st.entries) k.append(slug, e);
    buzz();
    const entry: Heard = { at: Date.now(), text, ok, said, test };
    setHeardLog(prev => {
      const next = [...prev, entry].slice(-300);
      try { localStorage.setItem(HEARD, JSON.stringify(next)); } catch { /* storage full */ }
      return next;
    });
  }

  // ---- The clock button: pause, resume (kickoffs start it) ----
  const clockBtn = s.phase !== "live" ? null
    : running ? { label: t("kp_pause"), run: () => log({ ...base(), k: "clock", h: s.clock.h, c: clockStr(clockNow()), run: false }) }
    : { label: t("kp_resume"), run: () => log({ ...base(), k: "clock", h: s.clock.h, c: clockStr(clockNow()), run: true }) };
  const secs = clockAt(s.clock, now);
  // Past the half's length the clock holds at it, with the added time beneath (stop-clock mode holds at 0:00).
  const regulation = setup.halfMin * 60;
  const over = s.phase === "live" && secs > regulation;
  const shown = over ? (setup.stopClock ? 0 : regulation) : setup.stopClock && s.phase === "live" ? regulation - secs : secs;

  const tokens = placeAll(s.on, setup);
  const bench = beginner ? [] : players.filter(p => !s.on.some(o => o.player === p.name));
  const last = lastUndoable(s);
  const lastEv = [...s.feed].reverse().find((e): e is Ev => e.k === "ev");
  const recent = [...s.feed].reverse().slice(0, 40);
  const holder = s.ball.holder;
  const isHolder = (a: Actor) => !!holder && (a.t === "D" ? holder.t === "D" && holder.player === a.player : holder.t === "O" && holder.opp === a.opp);
  const awaitingThrow = !holder && s.ball.loose?.kind === "restart" && lastEv?.type === "Throw-in" ? lastEv : null;

  const resultText = (e: Ev) => t(e.type === "Goal" ? "kp_res_goal" : `kp_res_${e.result ?? (e.on ? "saved" : "off")}` as Key);
  const sentence = (): string => {
    if (s.phase === "done") return t("kp_p_done");
    if (s.ball.kickoff) {
      if (s.phase === "pre") return t("kp_p_kickoff");
      if (s.phase === "break") return t("kp_p_second");
      return t("kp_p_kickoffTo", { team: s.ball.kickoff === "D" ? us : opp });
    }
    const e = lastEv;
    if (!e) return t("kp_p_tap");
    const who = nameOf(e);
    switch (e.type) {
      case "Kickoff": return t("kp_s_kickoff", { who });
      case "Pass":
        if (e.t === "O") return t(e.cross ? "kp_s_oppCross" : "kp_s_oppPass", { team: opp });
        return t(e.cross ? "kp_s_crossTo" : "kp_s_pass", { who, to: e.to ? firstName(e.to) : t("kp_myTeam") });
      case "Ball win": return t("kp_s_win", { who });
      case "Turnover": return t("kp_s_turnover", { who, them: t("kp_oppPlayer") });
      case "Cross": return t("kp_s_cross", { who });
      case "Clearance": return t("kp_s_clear", { who });
      case "Goal": return e.og ? t("kp_s_og", { who }) : t("kp_s_goal", { who });
      case "Shot": return `${t("kp_s_shot", { who })} ${resultText(e)}.${s.ball.loose ? ` ${t("kp_p_next")}` : ""}`;
      case "Throw-in": case "Corner": case "Goal kick": case "Free kick": case "Penalty": {
        const vars = { who: e.player ? firstName(e.player) : e.t === "D" ? us : opp, what: evName(e.type).toLowerCase() };
        return t(e.via === "cross" ? "kp_s_restartCross" : e.via === "long" ? "kp_s_restartLong" : e.via === "pass" ? "kp_s_restartShort" : "kp_s_restart", vars);
      }
      default: return `${evName(e.type)} · ${who}.`;
    }
  };
  const itemText = (e: FeedItem) => {
    if (e.k === "sub") return `${t("kp_sub")} · ${shortName(e.on)} ↔ ${shortName(e.off)}`;
    if (e.k === "move") return `${shortName(e.player)} → ${e.pos}`;
    const by = nameOf(e);
    if (e.type === "Pass") return `${e.cross ? t("kp_crossDone") : evName("Pass")} · ${e.t === "O" ? opp : `${by} → ${e.to ? firstName(e.to) : t("kp_myTeam")}`}`;
    if (e.type === "Shot") return `${evName("Shot")} · ${by} · ${resultText(e)}`;
    if (e.type === "Goal" && e.og) return `${t("kp_ownGoal")} · ${by}`;
    return `${evName(e.type)} · ${by}${e.assist ? ` (${t("kp_assist")} ${firstName(e.assist)})` : ""}`;
  };
  const statRows = stats(s);
  const feed = (items: FeedItem[]) => (
    <ol className="kp-feed">
      {items.map(e => (
        <li key={e.id}><button type="button" className={e.k === "ev" ? (e.t === "D" ? "d" : "o") : "n"} onClick={() => setSheet({ kind: "item", item: e })}>
          <span className="mono">{e.h}H {e.c}</span> {itemText(e)}
        </button></li>
      ))}
      {!items.length ? <li className="muted">{t("kp_nothingYet")}</li> : null}
    </ol>
  );
  const statTable = () => (
    <table className="kp-stats">
      <thead><tr><th>{us}</th><th /><th>{opp}</th></tr></thead>
      <tbody>{statRows.filter(r => r.us || r.them || ["Goals", "Shots", "On target"].includes(r.label.en)).map(r => (
        <tr key={r.label.en}><td className="dfc-t">{r.us}{r.unit}</td><th>{r.label[lang]}</th><td className="opp-t">{r.them}{r.unit}</td></tr>
      ))}</tbody>
    </table>
  );
  const oppPill = (who: "gk" | "pl") => {
    const label = who === "gk" ? t("kp_oppGk") : t("kp_oppPlayer");
    return (
      <button type="button" className={`kp-pill opp${isHolder({ t: "O", opp: who }) ? " ball" : ""}`}
        onPointerDown={e => drag.start(e, `opp:${who}`, <span className="kp-pill opp ghost">{label}</span>)}>
        <span className="num">{who === "gk" ? "GK" : "▲"}</span>{label}
        {isHolder({ t: "O", opp: who }) && s.ball.chain ? <em className="kp-chain">+{s.ball.chain}</em> : null}
      </button>
    );
  };
  const ourPick = (onPick: (a: Actor) => void, exclude?: string) => (
    <>
      {!beginner ? s.on.filter(o => o.player !== exclude).map(o => (
        <button key={o.player} type="button" className="kp-pill us" onClick={() => onPick({ t: "D", player: o.player })}>
          <span className="num">{tokenText(players, o.player)}</span>{firstName(o.player)}
        </button>
      )) : null}
      <button type="button" className="kp-pill us team" onClick={() => onPick({ t: "D" })}><span className="num">★</span>{t("kp_myTeam")}</button>
    </>
  );
  const theirPick = (onPick: (a: Actor) => void) => (
    <>
      <button type="button" className="kp-pill opp" onClick={() => onPick({ t: "O", opp: "pl" })}><span className="num">▲</span>{t("kp_oppPlayer")}</button>
      <button type="button" className="kp-pill opp" onClick={() => onPick({ t: "O", opp: "gk" })}><span className="num">GK</span>{t("kp_oppGk")}</button>
    </>
  );
  const dragging = drag.dragging && !drag.dragging.startsWith("b:");

  return (
    <main className={`kp-live${voiceOn ? " voice" : ""}`}>
      <header className="kp-bar">
        <a className="btn-line" href="#/keep" aria-label={t("kp_back")}>‹</a>
        <button type="button" className="btn-line kp-undo" disabled={!last} aria-label={t("kp_undo")} onClick={() => last && undo(last.id)}><span aria-hidden="true">↶</span><span className="kp-lbl"> {t("kp_undo")}</span></button>
        <div className="kp-score" aria-live="polite"><span className="dfc-t">{us}</span> <b>{s.score.us}–{s.score.them}</b> <span className="opp-t">{opp}</span></div>
        <button type="button" className={`kp-clock mono${running ? " run" : ""}${over ? " over" : ""}`} onClick={() => setSheet({ kind: "clock" })} aria-label={t("kp_clockTitle")}>
          <span>{s.phase === "done" ? t("fullTime") : s.phase === "break" ? t("halfTime") : `${s.clock.h}H`}</span> {clockStr(shown)}
          {over ? <em className="kp-added">+{clockStr(secs - regulation)}</em> : null}
        </button>
        {clockBtn ? <button type="button" className={`btn-solid kp-go${running ? " pause" : ""}`} aria-label={clockBtn.label} title={clockBtn.label} onClick={clockBtn.run}>{running ? "❚❚" : "▶"}</button> : null}
        {!beginner ? <button type="button" className="btn-line" aria-label={t("kp_subs")} title={t("kp_subs")} onClick={() => setSheet({ kind: "lineup" })}>⇅</button> : null}
        <button type="button" className={`btn-line${voiceOn ? " on" : ""}`} aria-pressed={voiceOn} aria-label={t("kp_voice")} title={t("kp_voice")} onClick={toggleVoice}>🎙</button>
      </header>

      <div className="kp-stage">
        <div className="kp-field">
          {voiceOn ? <VoiceBox onLine={onLine} last={heardLog[heardLog.length - 1] ?? null} history={heardLog.length} onShowHistory={() => setHeardSheet(true)} /> : null}
          <div className="kp-head">{oppPill("gk")}<p className="kp-prompt" aria-live="polite">{sentence()}</p>{oppPill("pl")}</div>
          <Pitch label={t("kp_pitchLabel")}>
            {beginner ? (
              <button type="button" className={`kp-pill us team${holder?.t === "D" ? " ball" : ""}`} style={place(50, 50)}
                onPointerDown={e => drag.start(e, "us:", <span className="kp-pill us ghost">{us}</span>)}>
                <span className="num">★</span>{t("kp_myTeam")}{holder?.t === "D" && s.ball.chain ? <em className="kp-chain">+{s.ball.chain}</em> : null}
              </button>
            ) : tokens.map(o => {
              const a: Actor = { t: "D", player: o.player };
              return (
                <button key={o.player} type="button" data-drop={`p:${o.player}`}
                  className={`kp-pill us${isHolder(a) ? " ball" : ""}${drag.dragging === `p:${o.player}` ? " lifted" : ""}`} style={place(o.x, o.y, flip)}
                  onPointerDown={e => drag.start(e, `p:${o.player}`, <span className="kp-pill us ghost"><span className="num">{tokenText(players, o.player)}</span>{firstName(o.player)}</span>)}>
                  <span className="num">{tokenText(players, o.player)}</span>{firstName(o.player)}
                  {isHolder(a) && s.ball.chain ? <em className="kp-chain">+{s.ball.chain}</em> : null}
                </button>
              );
            })}
            <span className="kp-dir" aria-hidden="true">{t("kp_attacking")} {flip ? "←" : "→"}</span>
          </Pitch>
          <div className="kp-actions">
            {!beginner ? (
              <button type="button" className={`kp-pill us team${holder?.t === "D" && !holder.player ? " ball" : ""}`} title={t("kp_myTeamHint")}
                onPointerDown={e => drag.start(e, "us:", <span className="kp-pill us team ghost"><span className="num">★</span>{t("kp_myTeam")}</span>)}>
                <span className="num">★</span>{t("kp_myTeam")}
                {holder?.t === "D" && !holder.player && s.ball.chain ? <em className="kp-chain">+{s.ball.chain}</em> : null}
              </button>
            ) : null}
            <button type="button" className="kp-act-btn" disabled={s.phase !== "live"} onClick={() => setFlow({ k: "out", step: "line" })}><span aria-hidden="true">→|</span> {t("kp_out")}</button>
            {awaitingThrow ? <button type="button" className="kp-act-btn warn" onClick={() => illegalThrow(awaitingThrow)}>{t("kp_illegalThrow")}</button> : null}
            <button type="button" className="kp-act-btn" disabled={s.phase === "pre"} onClick={() => setFlow({ k: "inf", step: "what" })}><span aria-hidden="true">⚑</span> {t("kp_infractions")}</button>
            <button type="button" className="kp-act-btn kp-stats-btn" onClick={() => setSheet({ kind: "stats" })}>{t("kp_stats")}</button>
            <SyncBadge />
          </div>
        </div>
        {!beginner ? (
          <div className="kp-bench" aria-label={t("kp_bench")}>
            <span className="eyebrow">{t("kp_bench")}</span>
            {bench.map(p => (
              <button key={p.name} type="button" className="kp-pill bench" onPointerDown={e => drag.start(e, `b:${p.name}`, <span className="kp-pill bench ghost">{firstName(p.name)}</span>)}>
                <span className="num">{tokenText(players, p.name)}</span>{firstName(p.name)}
              </button>
            ))}
            {!bench.length ? <span className="muted">{t("kp_benchEmpty")}</span> : null}
          </div>
        ) : null}
        <aside className="kp-side">
          <span className="eyebrow">{t("kp_log")}</span>
          {feed(recent)}
          <p className="kp-hint">{t(beginner ? "kp_hintBeginner" : "kp_hint")}</p>
          <div className="kp-side-stats">{statTable()}</div>
        </aside>
      </div>

      {/* While a player is being swiped: drop on what they did. */}
      {dragging ? (
        <div className="kp-zones" aria-hidden="true">
          {ZONES.map(z => <div key={z} className={`kp-zone z-${z.toLowerCase()}`} data-drop={`zone:${z}`}><b>{evName(z)}</b></div>)}
        </div>
      ) : null}
      {drag.layer}
      {toast ? (
        <div className="kp-toast" role="status">
          <span>{toast.text}</span>
          {toast.id ? <button type="button" className="btn-line" onClick={() => undo(toast.id)}>{t("kp_undo")}</button> : null}
        </div>
      ) : null}

      {flow?.k === "kickoff" ? (
        <Sheet title={s.phase === "break" ? t("kp_startSecond") : t("kp_startGameQ")} onClose={() => setFlow(null)}>
          <p>{t("kp_startNote", { who: nameOf(flow.a) })}</p>
          <div className="kp-row">
            <button type="button" className="btn-line" onClick={() => setFlow(null)}>{t("kp_cancel")}</button>
            <button type="button" className="btn-solid kp-start" onClick={() => startKickoff(flow.a)}>{t("kp_startRecording")}</button>
          </div>
        </Sheet>
      ) : null}

      {flow?.k === "shot" && flow.step === "from" ? (
        <Step title={t("kp_q_shotFrom")} onBack={() => setFlow(null)} backLabel={t("kp_cancel")}
          next={<button type="button" className="btn-line" onClick={() => setFlow({ ...flow, step: "to" })}>{t("kp_skip")}</button>}>
          <ShotSpot side={flow.a.t} label={t("kp_q_shotFrom")} onPick={(x, y) => setFlow({ ...flow, x, y, step: "to" })} />
        </Step>
      ) : null}
      {flow?.k === "shot" && flow.step === "to" ? (
        <Step title={t("kp_q_shotTo")} onBack={() => setFlow({ ...flow, step: "from" })}>
          <GoalMouth label={t("kp_q_shotTo")} onPick={g => {
            if (g.zone === "in") setFlow({ ...flow, goal: g, step: "result" });
            else finishShot({ ...flow, goal: g }, g.zone === "post" ? "post" : "off");
          }} />
          <button type="button" className="kp-result" onClick={() => finishShot(flow, "blocked")}><span aria-hidden="true">⤡</span> {t("kp_r_blockedField")}</button>
        </Step>
      ) : null}
      {flow?.k === "shot" && flow.step === "result" ? (
        <Step title={t("kp_q_shotResult")} onBack={() => setFlow({ ...flow, step: "to" })}>
          <div className="kp-results">
            <button type="button" className="kp-result" onClick={() => finishShot(flow, "saved")}><span aria-hidden="true">⤡</span> {t("kp_r_gkBlocked")}</button>
            <button type="button" className="kp-result" onClick={() => finishShot(flow, "caught")}><span aria-hidden="true">✋</span> {t("kp_r_gkCaught")}</button>
            <button type="button" className="kp-result goal" onClick={() => (flow.a.t === "D" && !beginner ? setFlow({ ...flow, step: "assist" }) : finishShot(flow, "goal"))}><span aria-hidden="true">⚽</span> {evName("Goal")}</button>
          </div>
        </Step>
      ) : null}
      {flow?.k === "shot" && flow.step === "assist" ? (
        <Step title={t("kp_q_assist")} onBack={() => setFlow({ ...flow, step: "result" })}>
          <div className="kp-picks">
            <button type="button" className="kp-pill none" onClick={() => finishShot(flow, "goal")}>✕ {t("kp_noAssist")}</button>
            {s.on.filter(o => o.player !== (flow.a.t === "D" ? flow.a.player : undefined)).map(o => (
              <button key={o.player} type="button" className={`kp-pill us${lastPasserTo(flow.a.t === "D" ? flow.a.player : undefined) === o.player ? " suggest" : ""}`} onClick={() => finishShot(flow, "goal", o.player)}>
                <span className="num">{tokenText(players, o.player)}</span>{firstName(o.player)}
              </button>
            ))}
          </div>
        </Step>
      ) : null}

      {flow?.k === "out" && flow.step === "line" ? (
        <Step title={flow.afterShot ? t("kp_q_outShot") : t("kp_q_outWhere")} onBack={() => setFlow(null)} backLabel={flow.afterShot ? t("kp_inPlay") : t("kp_cancel")}
          next={<button type="button" className="btn-solid kp-next" disabled={!flow.edge} onClick={() => setFlow({ ...flow, step: "taker" })}>{t("kp_nextStep")}</button>}>
          <LinePicker flip={flip} labels={{ aria: t("kp_q_outWhere"), ours: t("kp_ourGoal"), theirs: t("kp_theirGoal") }}
            onPick={(x, y, edge) => setFlow({ ...flow, x, y, edge })} />
        </Step>
      ) : null}
      {flow?.k === "out" && flow.step === "taker" ? (
        <Step title={flow.edge === "touch" ? t("kp_q_throwTaker") : t("kp_q_restartTaker")} onBack={() => setFlow({ ...flow, step: "line" })}>
          <section className="kp-taker">
            <p className="eyebrow">{us} · {evName(restartFor(flow.edge!, "D"))}</p>
            <div className="kp-picks">{ourPick(a => pickTaker(flow, a))}</div>
          </section>
          <section className="kp-taker">
            <p className="eyebrow">{opp} · {evName(restartFor(flow.edge!, "O"))}</p>
            <div className="kp-picks">{theirPick(a => pickTaker(flow, a))}</div>
          </section>
        </Step>
      ) : null}
      {flow?.k === "out" && flow.step === "type" ? (() => {
        const corner = restartFor(flow.edge!, flow.taker!.t) === "Corner";
        return (
          <Step title={corner ? t("kp_q_cornerType") : t("kp_q_goalKickType")} onBack={() => setFlow({ ...flow, step: "taker" })}>
            <div className="kp-types">
              <button type="button" className="kp-type" onClick={() => finishOut(flow, flow.taker!, "pass")}>{t("kp_via_pass")}</button>
              <button type="button" className="kp-type" onClick={() => finishOut(flow, flow.taker!, corner ? "cross" : "long")}>{corner ? t("kp_via_cross") : t("kp_via_long")}</button>
            </div>
          </Step>
        );
      })() : null}

      {flow?.k === "inf" && flow.step === "what" ? (
        <Step title={t("kp_q_what")} onBack={() => setFlow(null)} backLabel={t("kp_cancel")}>
          <div className="kp-infs">
            {INFRACTIONS.map(w => (
              <button key={w} type="button" className={`kp-inf i-${w.toLowerCase().replace(" ", "-")}`} onClick={() => setFlow({ k: "inf", step: "who", what: w })}>
                <span aria-hidden="true">{INF_ICON[w]}</span>{w === "Own goal" ? t("kp_ownGoal") : evName(w)}
              </button>
            ))}
          </div>
        </Step>
      ) : null}
      {flow?.k === "inf" && flow.step === "who" ? (
        <Step title={t("kp_q_who", { what: flow.what === "Own goal" ? t("kp_ownGoal") : evName(flow.what!) })} onBack={() => setFlow({ k: "inf", step: "what" })}>
          <div className="kp-picks">{ourPick(a => pickInfWho(flow, a))}{theirPick(a => pickInfWho(flow, a))}</div>
        </Step>
      ) : null}
      {flow?.k === "inf" && flow.step === "restart" ? (
        <Step title={t("kp_q_restart", { team: flow.who!.t === "D" ? opp : us })} onBack={() => setFlow({ ...flow, step: "who" })}>
          <div className="kp-results">
            <button type="button" className="kp-result" onClick={() => finishInf(flow.what!, flow.who!, "Free kick")}>{evName("Free kick")}</button>
            <button type="button" className="kp-result" onClick={() => finishInf(flow.what!, flow.who!, "Penalty")}>{evName("Penalty")}</button>
            <button type="button" className="kp-result" onClick={() => finishInf(flow.what!, flow.who!)}>{t("kp_playOn")}</button>
          </div>
        </Step>
      ) : null}

      {sheet?.kind === "lineup" ? (
        <Sheet title={t("kp_subs")} onClose={() => { setSheet(null); setLineSel(null); }}>
          <p className="sub">{lineSel ? t(lineSel.kind === "on" ? "kp_lineupPickedOn" : "kp_lineupPickedBench", { name: shortName(lineSel.name) }) : t("kp_lineupHint")}</p>
          <p className="eyebrow">{t("kp_onField")}</p>
          <div className="kp-list">
            {s.on.map(o => (
              <button key={o.player} type="button" className={`kp-li${lineSel?.name === o.player ? " on" : ""}`} aria-pressed={lineSel?.name === o.player} onClick={() => tapLine("on", o.player)}>
                <span className="num">{o.pos}</span><span>{o.player}</span><span className="muted">{tokenText(players, o.player)}</span>
              </button>
            ))}
          </div>
          <p className="eyebrow">{t("kp_bench")}</p>
          <div className="kp-list">
            {bench.map(p => (
              <button key={p.name} type="button" className={`kp-li${lineSel?.name === p.name ? " on" : ""}`} aria-pressed={lineSel?.name === p.name} onClick={() => tapLine("bench", p.name)}>
                <span className="num">{p.number ?? "–"}</span><span>{p.name}</span><span className="muted">{p.positions.join(" · ")}</span>
              </button>
            ))}
            {!bench.length ? <span className="muted">{t("kp_benchEmpty")}</span> : null}
          </div>
        </Sheet>
      ) : null}
      {sheet?.kind === "player" ? (
        <Sheet title={`${shortName(sheet.name)} · ${posOf(sheet.name) ?? ""}`} onClose={() => setSheet(null)}>
          <p className="eyebrow">{t("kp_subOffFor")}</p>
          <div className="kp-list">
            {bench.map(p => <button key={p.name} type="button" className="kp-li" onClick={() => { sub(sheet.name, p.name); setSheet(null); }}><span className="num">{p.number ?? "–"}</span><span>{p.name}</span></button>)}
          </div>
          <p className="eyebrow">{t("kp_movePosition")}</p>
          <div className="kp-chips">
            {Object.keys(POSITIONS).map(p => (
              <button key={p} type="button" className={`kp-chip${posOf(sheet.name) === p ? " on" : ""}`} disabled={posOf(sheet.name) === p}
                onClick={() => { log({ ...base(), k: "move", ...moment(), player: sheet.name, pos: p }, `${shortName(sheet.name)} → ${p}`); setSheet(null); }}>{p}</button>
            ))}
          </div>
          <p className="eyebrow">{t("kp_swapWith")}</p>
          <div className="kp-list">
            {s.on.filter(o => o.player !== sheet.name).map(o => (
              <button key={o.player} type="button" className="kp-li" onClick={() => { swap(sheet.name, o.player); setSheet(null); }}>
                <span className="num">{o.pos}</span><span>{o.player}</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
      {sheet?.kind === "bench" ? (
        <Sheet title={`${t("kp_bringOn")} ${shortName(sheet.name)}`} onClose={() => setSheet(null)}>
          <p className="eyebrow">{t("kp_forWhom")}</p>
          <div className="kp-list">
            {s.on.map(o => <button key={o.player} type="button" className="kp-li" onClick={() => { sub(o.player, sheet.name); setSheet(null); }}><span className="num">{o.pos}</span><span>{o.player}</span></button>)}
          </div>
        </Sheet>
      ) : null}
      {heardSheet ? (
        <Sheet title={t("kp_voiceHistory")} onClose={() => setHeardSheet(false)}>
          <div className="kp-row">
            <button type="button" className="btn-line" onClick={() => { navigator.clipboard?.writeText(heardLog.map(h => `${new Date(h.at).toLocaleTimeString()}\t${h.ok ? "ok" : "MISS"}${h.test ? " (test)" : ""}\t${h.text}\t${h.said}`).join("\n")).then(() => setToast({ text: t("kp_voiceCopied"), id: "" }), () => {}); }}>{t("kp_voiceCopy")}</button>
            <button type="button" className="btn-line" onClick={() => { setHeardLog([]); try { localStorage.removeItem(HEARD); } catch { /* nothing stored */ } }}>{t("kp_clear")}</button>
          </div>
          <ol className="kp-feed kp-heard">
            {[...heardLog].reverse().map((h, i) => (
              <li key={i} className={h.ok ? "ok" : "bad"}><span className="mono">{new Date(h.at).toLocaleTimeString()}</span> “{h.text}”{h.test ? ` (${t("kp_voiceTest")})` : ""}<br /><span className="muted">{h.said}</span></li>
            ))}
            {!heardLog.length ? <li className="muted">{t("kp_voiceNone")}</li> : null}
          </ol>
        </Sheet>
      ) : null}
      {sheet?.kind === "clock" ? <ClockSheet s={s} slug={slug} onClose={() => setSheet(null)} log={log} secs={clockNow()} /> : null}
      {sheet?.kind === "stats" ? <Sheet title={t("kp_stats")} onClose={() => setSheet(null)}>{statTable()}{feed(recent)}</Sheet> : null}
      {sheet?.kind === "item" ? (
        <Sheet title={`${sheet.item.h}H ${sheet.item.c}`} onClose={() => setSheet(null)}>
          <p>{itemText(sheet.item)}</p>
          <button type="button" className="btn-solid kp-danger" onClick={() => { undo(sheet.item.id); setSheet(null); }}>{t("kp_remove")}</button>
        </Sheet>
      ) : null}
    </main>
  );
}

function ClockSheet({ s, slug, onClose, log, secs }: { s: KeepState; slug: string; onClose: () => void; log: (e: KeepEntry, text?: string) => void; secs: number }) {
  const { t } = useI18n();
  const [val, setVal] = useState(clockStr(secs));
  const ok = /^\d{1,3}:[0-5]\d$/.test(val);
  const running = s.clock.since != null;
  const half = s.clock.h;
  const set = () => { if (ok) { log({ id: newId(), at: Date.now(), k: "clock", h: half, c: val, run: running }); onClose(); } };
  const nudge = (d: number) => setVal(clockStr(Math.max(0, (ok ? sec(val) : secs) + d)));
  return (
    <Sheet title={t("kp_clockTitle")} onClose={onClose}>
      {s.phase === "live" ? (
        <>
          <p className="eyebrow">{t("kp_setClock")}</p>
          <div className="kp-row">
            <button type="button" className="btn-line" onClick={() => nudge(-10)}>−10s</button>
            <input className="mono kp-clock-in" value={val} onChange={e => setVal(e.target.value)} inputMode="numeric" aria-label={t("kp_setClock")} />
            <button type="button" className="btn-line" onClick={() => nudge(10)}>+10s</button>
            <button type="button" className="btn-line" disabled={!ok} onClick={set}>{t("kp_set")}</button>
          </div>
          <p className="sub">{t("kp_clockElapsed")}</p>
          <button type="button" className="btn-solid kp-danger" onClick={() => { log({ id: newId(), at: Date.now(), k: "end", h: half, c: clockStr(secs) }); onClose(); }}>
            {half === 1 ? t("kp_endHalf") : t("kp_endGame")}
          </button>
        </>
      ) : <p className="sub">{t(`kp_phase_${s.phase}` as Key)}</p>}
      <a className="btn-line" href={`#/keep/g/${encodeURIComponent(slug)}/setup`}>{t("kp_editSetup")}</a>
    </Sheet>
  );
}
