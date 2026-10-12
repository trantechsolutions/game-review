import { useState } from "react";
import { T } from "../components/RichText";
import { NoteButton, useNoteCounts } from "../components/Notes";
import { useI18n, type Key } from "../i18n";
import { mmss, sec } from "../lib/time";
import type { Game } from "../schema";
import { useSite } from "../site";
import { useDateLine } from "./shared";

export function Highlights({ game: g }: { game: Game }) {
  const { t } = useI18n();
  const { manifest } = useSite();
  const dateLine = useDateLine(g);
  const count = useNoteCounts(g.slug);
  return (
    <div className="pg-hl">
      <header className="strip">
        <div className="wrap">
          <span className="eyebrow">{t("highlights")} · {dateLine}</span>
          <h1>{manifest.us} {g.score.us}–{g.score.them} {g.opponent}</h1>
        </div>
      </header>
      <main className="wrap">
        <div className="grid">
          {g.highlights.clips.map(c => <Clip key={c.id} g={g} clip={c} count={count(`clip:${c.id}`)} />)}
        </div>
      </main>
    </div>
  );
}

type HlClip = Game["highlights"]["clips"][number];

function Clip({ g, clip, count }: { g: Game; clip: HlClip; count: number }) {
  const { t, tx } = useI18n();
  const { manifest, loadClip } = useSite();
  const [src, setSrc] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "fetch" | "decrypt" | "error">("idle");
  const info = manifest.clips[`${g.slug}/${clip.id}`];
  const mb = info ? Math.max(1, Math.round(info.bytes / 1e6)) : 0;
  const label = tx(clip.label);

  async function load() {
    try { setSrc(await loadClip(g.slug, clip.id, setStage)); } catch { setStage("error"); }
  }

  return (
    <figure>
      <div className="frame">
        <video controls playsInline preload="none" src={src ?? undefined} aria-label={label} autoPlay={!!src} />
        {!src && info ? (
          <button type="button" onClick={load} disabled={stage === "fetch" || stage === "decrypt"}>
            {stage === "fetch" ? t("loadingClip") : stage === "decrypt" ? t("decrypting") : stage === "error" ? t("clipFailed") : t("loadClip", { mb })}
          </button>
        ) : null}
      </div>
      <figcaption>
        <p className="meta">
          <span className={`tag ${clip.tag}`}>{t(`tag_${clip.tag}` as Key)}</span>
          <span>{t("fullVideo", { from: clip.start, to: clip.end })}</span>
          <span>{mmss(sec(clip.end) - sec(clip.start))}</span>
        </p>
        <p className="label"><span><T t={clip.label} /></span><NoteButton slug={g.slug} anchor={`clip:${clip.id}`} label={label} count={count} /></p>
      </figcaption>
    </figure>
  );
}
