// The live screen's voice strip. Dictation (Wispr Flow, or any keyboard's voice typing) types into the box;
// each line runs when it stops changing (or on Enter). The mic button is a fallback that uses the phone's
// own speech recognition while held. "Test only" shows what a line would log without logging it, and the
// history (kept on this phone) can be copied out to tune the phrases.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

export interface Heard { at: number; text: string; ok: boolean; said: string; test: boolean }

interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
}
const SR = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const STORE = "dfc-keeper-voice-prefs";
const prefs = (): { test: boolean; hideKeys: boolean } => {
  try { return { test: false, hideKeys: false, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { return { test: false, hideKeys: false }; }
};

export function VoiceBox({ onLine, last, history, onShowHistory }: {
  onLine: (text: string, test: boolean) => void; last: Heard | null; history: number; onShowHistory: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState("");
  const [opts, setOpts] = useState(prefs);
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef<string[]>([]);

  const setOpt = (k: "test" | "hideKeys", v: boolean) => {
    const next = { ...opts, [k]: v };
    setOpts(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const run = (value: string) => {
    clearTimeout(timer.current);
    const line = value.trim();
    if (!line) return;
    onLine(line, opts.test);
    setText("");
    input.current?.focus();
  };
  // Dictation types a whole phrase at once; wait for it to stop changing before reading it.
  const change = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v), 1200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const Ctor = SR();
  const startMic = () => {
    if (!Ctor || listening) return;
    const r = new Ctor();
    r.lang = lang === "es" ? "es-US" : "en-US";
    r.continuous = true;
    r.interimResults = false;
    heard.current = [];
    r.onresult = e => { for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) heard.current[i] = e.results[i][0].transcript; };
    r.onend = () => { setListening(false); run(heard.current.filter(Boolean).join(", ")); };
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };
  const stopMic = () => { try { rec.current?.stop(); } catch { /* already stopped */ } };

  return (
    <div className={`kp-voice${opts.test ? " test" : ""}`}>
      <input ref={input} className="kp-voice-in" value={text} placeholder={t("kp_voicePlaceholder")} aria-label={t("kp_voice")}
        inputMode={opts.hideKeys ? "none" : "text"} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send"
        onChange={e => change(e.target.value)} onKeyDown={e => { if (e.key === "Enter") run(text); }} />
      {Ctor ? (
        <button type="button" className={`btn-line kp-mic${listening ? " on" : ""}`} aria-label={t("kp_holdToTalk")} title={t("kp_holdToTalk")}
          onPointerDown={e => { e.preventDefault(); startMic(); }} onPointerUp={stopMic} onPointerLeave={stopMic} onPointerCancel={stopMic}>🎙</button>
      ) : null}
      <label className="check"><input type="checkbox" checked={opts.test} onChange={e => setOpt("test", e.target.checked)} /> {t("kp_voiceTest")}</label>
      <label className="check"><input type="checkbox" checked={opts.hideKeys} onChange={e => setOpt("hideKeys", e.target.checked)} /> {t("kp_voiceHideKeys")}</label>
      <button type="button" className="btn-line" onClick={onShowHistory}>{t("kp_voiceHistory")} ({history})</button>
      {last ? (
        <p className={`kp-voice-last${last.ok ? " ok" : " bad"}`} role="status">
          <span className="heard">“{last.text}”</span> {last.test ? <em>{t("kp_voiceWould")}</em> : null} {last.said}
        </p>
      ) : <p className="kp-voice-last muted">{t("kp_voiceHint")}</p>}
    </div>
  );
}
