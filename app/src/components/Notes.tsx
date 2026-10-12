// Coach-notes UI: the sign-in dialog, per-item note buttons and the notes drawer.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { BadCoachPassword, useGameNotes, useNotes, type Note } from "../notes";

const AUTHOR = "dfc-notes-author";

/** Close on Escape wherever focus is (a disabled submit button drops focus to the page). */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
}

function Icon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 2.5h7l3 3v8H3z" /><path d="M5.5 7h5M5.5 10h5" />
    </svg>
  );
}

/** A small button that opens the drawer on one anchor; shows the count when notes exist. */
export function NoteButton({ slug, anchor, label, count }: { slug: string; anchor: string; label: string; count: number }) {
  const { signedIn, openDrawer } = useNotes();
  const { t } = useI18n();
  if (!signedIn) return null;
  return (
    <button type="button" className={`note-btn${count ? " has" : ""}`} onClick={() => openDrawer(slug, anchor, label)}
      aria-label={`${t("notes")}: ${label}${count ? ` (${count})` : ""}`} title={t("addNoteHere")}>
      <Icon />{count ? count : "+"}
    </button>
  );
}

/** Count notes per anchor for a game. */
export function useNoteCounts(slug: string) {
  const { notes } = useGameNotes(slug);
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) m.set(n.anchor, (m.get(n.anchor) ?? 0) + 1);
    return (anchor: string) => m.get(anchor) ?? 0;
  }, [notes]);
}

export function CoachLogin() {
  const { loginOpen, setLoginOpen, signIn } = useNotes();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (loginOpen) { setMsg(""); input.current?.focus(); } }, [loginOpen]);
  useEscape(loginOpen, () => setLoginOpen(false));
  if (!loginOpen) return null;

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true); setMsg(t("checking"));
    try {
      await signIn(String(f.get("pw")).trim(), f.get("remember") === "on");
      setLoginOpen(false);
    } catch (err) {
      setMsg(err instanceof BadCoachPassword ? t("badCoachPassword") : t("notesError"));
    } finally { setBusy(false); }
  }

  return (
    <div className="scrim center" onClick={e => { if (e.target === e.currentTarget) setLoginOpen(false); }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="coach-h" onSubmit={submit}>
        <h2 id="coach-h">{t("coachSignIn")}</h2>
        <p className="sub">{t("coachSignInHelp")}</p>
        <div className="field">
          <label htmlFor="coach-pw">{t("coachPassword")}</label>
          <input ref={input} id="coach-pw" name="pw" type={show ? "text" : "password"} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
        </div>
        <label className="check"><input name="remember" type="checkbox" /> {t("keepSignedIn")}</label>
        <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> {t("showPassword")}</label>
        <p className="msg" role="alert">{msg}</p>
        <div className="row-actions">
          <button type="button" className="btn-line" onClick={() => setLoginOpen(false)}>{t("cancel")}</button>
          <button type="submit" className="btn-solid" disabled={busy}>{t("signIn")}</button>
        </div>
      </form>
    </div>
  );
}

/** The drawer for the open game. `labelFor` turns an anchor into a readable label. */
export function NotesDrawer({ slug, labelFor }: { slug: string; labelFor: (anchor: string) => string }) {
  const { drawer, closeDrawer, openDrawer, save, remove } = useNotes();
  const { notes, error } = useGameNotes(slug);
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Note | null>(null);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem(AUTHOR) ?? ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  const anchor = drawer?.slug === slug ? drawer.anchor : null;
  useEffect(() => { setEditing(null); setText(""); setMsg(""); }, [anchor]);
  useEscape(!!anchor, closeDrawer);
  if (!anchor || !drawer) return null;

  const anchors = [...new Set(["game", anchor, ...notes.map(n => n.anchor)])];
  const shown = anchor === "*" ? notes : notes.filter(n => n.anchor === anchor);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setMsg(t("saving"));
    try {
      try { localStorage.setItem(AUTHOR, author); } catch { /* storage blocked */ }
      await save({ id: editing?.id, slug, anchor: editing?.anchor ?? (anchor === "*" ? "game" : anchor!), text: text.trim(), author: author.trim() });
      setEditing(null); setText(""); setMsg("");
    } catch { setMsg(t("notesError")); } finally { setBusy(false); }
  }

  async function del(n: Note) {
    if (!confirm(t("confirmDelete"))) return;
    try { await remove(n.id); } catch { setMsg(t("notesError")); }
  }

  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) closeDrawer(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="notes-h">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">{t("notesFor")}</span>
            <h2 id="notes-h">{anchor === "*" ? t("notes") : labelFor(anchor)}</h2>
          </div>
          <button type="button" className="btn-line" onClick={closeDrawer} autoFocus>{t("close")}</button>
        </div>

        <div className="anchor-tabs" role="group" aria-label={t("notes")}>
          <button type="button" aria-pressed={anchor === "*"} onClick={() => openDrawer(slug, "*", t("notes"))}>{t("everything")} ({notes.length})</button>
          {anchors.map(a => (
            <button key={a} type="button" aria-pressed={anchor === a} onClick={() => openDrawer(slug, a, labelFor(a))}>
              {labelFor(a)} ({notes.filter(n => n.anchor === a).length})
            </button>
          ))}
        </div>

        {error ? <p className="msg">{t("notesError")}</p> : null}
        {shown.length === 0 ? <p className="sub">{t("noNotes")}</p> : (
          <ul className="note-list">
            {shown.map(n => (
              <li key={n.id} className="note-item">
                <p className="text">{n.text}</p>
                <p className="by">
                  {n.author ? <span>{n.author}</span> : null}
                  <span>{t("updated", { when: when(n.updatedAt) })}</span>
                  {anchor === "*" ? <span>{t("noteOn", { what: labelFor(n.anchor) })}</span> : null}
                </p>
                <div className="acts">
                  <button type="button" className="note-btn" onClick={() => { setEditing(n); setText(n.text); area.current?.focus(); }}>{t("edit")}</button>
                  <button type="button" className="note-btn" onClick={() => del(n)}>{t("delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label htmlFor="note-text">{editing ? t("edit") : t("addNote")}{anchor === "*" && !editing ? ` · ${labelFor("game")}` : ""}</label>
            <textarea ref={area} id="note-text" value={text} onChange={e => setText(e.target.value)} placeholder={t("notePlaceholder")} required maxLength={4000} />
          </div>
          <div className="field">
            <label htmlFor="note-author">{t("author")}</label>
            <input id="note-author" value={author} onChange={e => setAuthor(e.target.value)} placeholder={t("authorPlaceholder")} maxLength={60} />
          </div>
          <p className="msg" role="status">{msg}</p>
          <div className="row-actions">
            {editing ? <button type="button" className="btn-line" onClick={() => { setEditing(null); setText(""); }}>{t("cancel")}</button> : null}
            <button type="submit" className="btn-solid" disabled={busy || !text.trim()}>{t("save")}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
