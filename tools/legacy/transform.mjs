// One-off: private/data/raw/<slug>.json (from scrape.mjs) + the old game list + highlights.json
// → private/data/games/<slug>.json in the new format, with every Spanish string left empty
// for tools/i18n.mjs to fill.
//   node tools/legacy/transform.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = join(ROOT, "private", "data", "raw");
const OUT = join(ROOT, "private", "data", "games");
mkdirSync(OUT, { recursive: true });

const T = en => ({ en, es: "" });
const Tn = en => (en ? T(en) : undefined);
const sec = c => c.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// The old game list: GAMES array in private/site/index.html.
const indexHtml = readFileSync(join(ROOT, "private", "legacy", "site", "index.html"), "utf8");
const LIST = Function(`return ${indexHtml.match(/const GAMES = (\[[\s\S]*?\n {2}\]);/)[1]}`)();
const HL = JSON.parse(readFileSync(join(ROOT, "private", "legacy", "highlights.json"), "utf8")).games;

const TYPE = { "Red card": "Red", "Yellow card": "Yellow" };
const html2md = s => s.replace(/<(em|i)>([\s\S]*?)<\/\1>/g, "*$2*").replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, "**$2**")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

for (const file of readdirSync(RAW)) {
  const raw = JSON.parse(readFileSync(join(RAW, file), "utf8"));
  const { slug, pbp, report: R, coaches: C } = raw;
  const listed = LIST.find(g => g.slug === slug);
  const hl = HL.find(g => g.slug === slug);

  // ---- video timing ----
  const cfg = pbp.CFG;
  const ko = cfg ? cfg.ko : pbp.KO;
  const wc = cfg
    ? { step: cfg.step, len: cfg.len, count: cfg.clips, prefix: cfg.prefix }
    : { step: 290, len: 300, count: pbp.CLIPS.length, prefix: "clip_" };
  const halfLen = pbp.halves.map(h => h.meta.match(/(\d+:\d{2}) played/)[1]);
  // Pages that explain the Game column as "the minute in progress" used Reeplayer's running minute (+1);
  // the others counted elapsed minutes, or hid the column.
  const minute = cfg && !cfg.showGame ? null : pbp.footer.some(p => /minute in progress/.test(p)) ? "running" : "elapsed";

  // ---- events ----
  const used = new Set();
  const events = pbp.EVENTS.map(e => {
    let id = `${e.h}-${e.c.replace(":", "")}`;
    while (used.has(id)) id += "b";
    used.add(id);
    const ev = { id, h: e.h, c: e.c, t: e.t === "D" || e.t === "N" ? e.t : "O", y: TYPE[e.y] || e.y, d: T(e.d) };
    if (e.on !== undefined) ev.on = e.on;
    if (e.f) ev.f = T(e.f);
    return ev;
  });
  const vsec = e => ko[e.h] + sec(e.c);

  // ---- match report phases → event ids ----
  const reportHalves = [0, 1].map(i => {
    const h = i + 1, scraped = R.halves[i];
    let phases;
    if (R.PHASES) {
      phases = R.PHASES[h].map(p => ({
        title: T(p.title), range: T(`${p.from} – ${p.to}`), read: T(p.read),
        events: events.filter(e => e.h === h && sec(e.c) >= sec(p.from) && sec(e.c) <= sec(p.to)).map(e => e.id),
      }));
    } else {
      phases = R[`H${h}`].map(p => ({
        title: T(p.title), range: T(p.range), read: T(p.read),
        events: p.ev.map(row => {
          const noClipColumn = /^[DOKN]$/.test(row[2]);
          const [, v] = row;
          const [type, d, flag] = noClipColumn ? row.slice(3) : row.slice(4);
          const y = TYPE[type] || type;
          const match = events.find(e => e.h === h && Math.abs(vsec(e) - sec(v)) <= 1)
            || events.find(e => e.h === h && e.y === y && Math.abs(vsec(e) - sec(v)) <= 30);
          if (!match) throw new Error(`${slug}: report event at video ${v} not in the play-by-play`);
          if (flag === "key") match.key = true;
          // The report's wording, unless it is just the play-by-play's (plus "On target." and the note).
          const rd = html2md(d);
          const same = [match.d.en, match.d.en + (match.on ? " On target." : "")]
            .flatMap(x => [x, match.f ? `${x} *${match.f.en}*` : x]).includes(rd);
          const o = { id: match.id };
          if (!same) o.d = T(rd);
          if (y !== match.y) o.label = T(type);
          return o.d || o.label ? o : match.id;
        }),
      }));
    }
    return { eyebrow: T(scraped.eyebrow), title: T(scraped.title), pills: scraped.pills.map(T), phases };
  });

  // ---- numbers ----
  // Two stat tables means the stats app compared against the event log.
  const tableTitles = R.numbers.bars.length === 2 ? ["Stats app", "Event log"] : [null];
  const tables = R.numbers.bars.map((b, i) => ({
    title: tableTitles[i] ? T(tableTitles[i]) : null,
    rows: b.rows.map(([label, us, them]) => {
      const unit = /%$/.test(us) ? "%" : undefined;
      const row = { label: T(label), us: parseFloat(us), them: parseFloat(them) };
      if (unit) row.unit = unit;
      return row;
    }),
  }));

  // ---- report clips ----
  const clipItems = R.CLIPS && Array.isArray(R.CLIPS[0])
    ? R.CLIPS.map(([t, what, file, at]) => ({ t: t === "D" ? "D" : "O", what: T(what), file, at }))
    : R.clips.items.map(c => ({ t: /\bD\b/.test(c.cls) ? "D" : "O", what: T(c.what), file: c.file, at: c.at }));

  const [decided, work] = R.takeaways.cols;
  const point = p => { const o = { title: T(p.title), body: T(p.body) }; if (p.tag) o.tag = T(p.tag); return o; };

  const generic = new Set(["Large marker = goal", "Clock = minutes into each half", "Yellow card", "DFC shot"]);
  const legendNote = R.story.legend.filter(l => !generic.has(l) && !/ shot \((above|below)\)$| goal \((above|below)\)$/.test(l)).join(" · ");

  const comp = pbp.eyebrows[1].replace(/ · HT \d+–\d+$/, "");

  const game = {
    slug,
    date: listed.date, time: listed.time, opponent: listed.opp,
    home: /· Home\b/.test(pbp.eyebrows[0]) ? true : /· Away\b/.test(pbp.eyebrows[0]) ? false : null,
    competition: T(comp),
    listContext: T(listed.ctx),
    score: { us: listed.us, them: listed.them, ...(() => { const [a, b] = C.meta.find(m => /HT/.test(m)).match(/HT (\d+)–(\d+)/).slice(1).map(Number); return { htUs: a, htThem: b }; })() },
    goals: pbp.goals.map(g => ({ t: g.cls === "gd" ? "D" : "O", label: T(g.md) })),
    video: {
      kickoff: { 1: ko[1], 2: ko[2] },
      halfLength: { 1: halfLen[0], 2: halfLen[1] },
      minute,
      workingClips: wc,
    },
    halves: pbp.halves.map(h => ({ title: T(h.title), meta: T(h.meta) })),
    events,
    playByPlayFooter: pbp.footer.map(T),
    report: {
      eyebrow: T(R.boardTop[0]),
      scorers: { us: T(R.scorers[0]), them: T(R.scorers[1]) },
      board: R.boardFoot.map(T),
      story: { eyebrow: T(R.story.eyebrow), title: T(R.story.title), lede: T(R.story.lede), ...(legendNote ? { legendNote: T(legendNote) } : {}) },
      halves: reportHalves,
      numbers: { eyebrow: T(R.numbers.eyebrow), title: T(R.numbers.title), ...(R.numbers.sub ? { sub: T(R.numbers.sub) } : {}), tables },
      takeaways: {
        eyebrow: T(R.takeaways.eyebrow), title: T(R.takeaways.title),
        decidedTitle: T(decided.title), decided: decided.points.map(point),
        workTitle: T(work.title), work: work.points.map(point),
      },
      clips: { eyebrow: T(R.clips.eyebrow), title: T(R.clips.title), sub: T(R.clips.sub), items: clipItems },
      footer: R.footer.map(T),
    },
    coaches: {
      eyebrow: T(C.eyebrow),
      title: T(C.h1Accent ? C.h1.slice(0, C.h1.length - C.h1Accent.length).trim() : C.h1),
      titleAccent: C.h1Accent ? T(C.h1Accent) : null,
      intro: T(C.intro),
      meta: C.meta.map(T),
      priorities: { eyebrow: T(C.priorities.eyebrow), title: T(C.priorities.title), items: C.priorities.items.map(p => ({ title: T(p.title), body: T(p.body) })) },
      thirds: {
        eyebrow: T(C.thirds.eyebrow), title: T(C.thirds.title), sub: T(C.thirds.sub),
        zones: C.thirds.zones.map(z => ({ name: T(z.name), title: T(z.title), pri: z.pri, text: T(z.text), counts: z.counts.map(T) })),
        blocks: C.thirds.blocks.map(b => ({
          name: T(b.name), title: T(b.title), intro: T(b.intro), keep: b.keep.map(T),
          fixes: b.fixes.map(f => {
            const o = { pri: f.pri, title: T(f.title), body: T(f.body), ev: f.ev };
            if (f.coach) o.coach = T(f.coach.replace(/^\*\*Coach it:\*\*\s*/, ""));
            return o;
          }),
        })),
      },
      units: {
        eyebrow: T(C.units.eyebrow), title: T(C.units.title), sub: T(C.units.sub),
        items: C.units.items.map(u => ({ name: T(u.name), pos: u.pos, verdict: T(u.verdict), items: u.items.map(i => ({ pri: i.pri, text: T(i.text), ev: i.ev })) })),
      },
      plan: {
        eyebrow: T(C.plan.eyebrow), title: T(C.plan.title), sub: T(C.plan.sub),
        sessions: C.plan.items.map(s => ({ slot: T(s.slot), duration: T(s.duration), title: T(s.title), items: s.items.map(T), ...(s.fixes ? { fixes: T(s.fixes) } : {}) })),
      },
      clips: {
        eyebrow: T(C.clips.eyebrow), title: T(C.clips.title), sub: T(C.clips.sub),
        rows: C.clips.rows.map(([topic, moment, file, at, unit]) => ({ topic: T(topic), moment: T(moment), file, at, unit: T(unit) })),
      },
      footer: C.footer.map(T),
    },
    highlights: {
      source: hl.source,
      clips: hl.clips.map(c => ({ id: c.id, label: T(c.label), tag: c.tag, start: c.start, end: c.end })),
    },
  };
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(game, null, 2) + "\n");
  console.log(slug, events.length, "events,", reportHalves.flatMap(h => h.phases).length, "phases");
}
