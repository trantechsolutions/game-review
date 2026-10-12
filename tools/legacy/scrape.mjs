// One-off: renders each legacy game page in Chromium and dumps its content as raw JSON
// (English only, inline markup **bold** *italic* `mono`) to private/data/raw/<slug>.json.
//   node tools/legacy/scrape.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAMES = join(ROOT, "private", "legacy", "site", "games");
const OUT = join(ROOT, "private", "data", "raw");
mkdirSync(OUT, { recursive: true });

// Runs in the page: HTML → inline markup.
const HELPERS = `
  window.__md = function md(node) {
    if (typeof node === "string") { const d = document.createElement("div"); d.innerHTML = node; node = d; }
    let out = "";
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.textContent; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase(), inner = md(n);
      if (tag === "b" || tag === "strong") out += inner.trim() ? "**" + inner.trim() + "**" : "";
      else if (tag === "i" || tag === "em") out += inner.trim() ? "*" + inner.trim() + "*" : "";
      else if (tag === "code" || n.classList.contains("mono")) out += "\`" + inner.trim() + "\`";
      else if (tag === "br") out += " ";
      else out += inner;
    }
    return out.replace(/\\s+/g, " ").trim();
  };
  window.__q = (sel, root = document) => root.querySelector(sel);
  window.__qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  window.__mdq = (sel, root = document) => { const e = root.querySelector(sel); return e ? __md(e) : null; };
`;

const tryEval = async (page, name) => page.evaluate(`typeof ${name} === "undefined" ? null : ${name}`);

async function pbp(page) {
  return page.evaluate(`({
    title: document.title,
    eyebrows: __qa("header .eyebrow").map(__md),
    h1: __md(__q("header h1")),
    goals: __qa("header .goals span").map(s => ({ cls: s.className, md: __md(s) })),
    halves: __qa("section.half").map(s => ({ title: __mdq("h2", s), meta: __mdq(".meta", s) })),
    footer: __qa("footer p").map(__md),
    headers: __qa("thead th").slice(0, 6).map(__md),
  })`);
}

async function report(page) {
  return page.evaluate(`(() => {
    const sec = id => document.getElementById(id);
    const head = s => ({ eyebrow: __mdq(".sec-head .eyebrow", s), title: __mdq(".sec-head h2", s), sub: __mdq(".sec-head .sub", s) });
    return {
      boardTop: __qa(".board-top .eyebrow").map(__md),
      scorers: __qa(".team-scorers").map(__md),
      boardFoot: __qa(".board-foot > span").map(__md),
      toc: __qa("nav.toc a").map(a => [a.getAttribute("href"), __md(a)]),
      story: { ...head(sec("story")), lede: __mdq(".lede", sec("story")), legend: __qa(".legend > span", sec("story")).map(__md) },
      halves: ["first-half", "second-half"].map(id => ({ ...head(sec(id)), pills: __qa(".pill", sec(id)).map(__md),
        phases: __qa(".phase", sec(id)).map(p => ({ range: __mdq(".range", p), title: __mdq("h3", p), read: __mdq(".phase-intro p", p),
          ev: __qa(".ev", p).map(e => ({ cls: e.className, clock: __mdq(".clock", e), chip: __mdq(".chip", e), desc: __mdq(".desc", e) })) })),
        mini: __qa(".ms", sec(id)).map(__md) })),
      numbers: { ...head(sec("numbers")), bars: __qa(".bars", sec("numbers")).map(b => ({
        prev: b.previousElementSibling ? __md(b.previousElementSibling) : null,
        head: __qa(".bars-head span", b).map(__md),
        rows: __qa(".bar-row", b).map(r => [__mdq(".bar-label", r), __mdq(".bar-side.l .bar-num", r), __mdq(".bar-side.r .bar-num", r)]) })) },
      takeaways: { ...head(sec("takeaways")), cols: __qa(".col", sec("takeaways")).map(c => ({ title: __mdq("h3", c),
        points: __qa(".points li", c).map(li => ({ title: __mdq("b", li), tag: __mdq(".tag", li), body: __mdq("p", li) })) })) },
      notes: __qa("main .note").filter(n => !n.closest(".events")).map(n => ({ in: n.closest("section")?.id, md: __md(n) })),
      clips: { ...head(sec("clips")), items: __qa(".clip", sec("clips")).map(c => ({ cls: c.className, what: __mdq(".what", c), at: __mdq(".at", c), file: __mdq(".file", c) })) },
      footer: __qa("footer p").map(__md),
    };
  })()`);
}

async function coaches(page) {
  return page.evaluate(`(() => {
    const sec = id => document.getElementById(id);
    const head = s => ({ eyebrow: __mdq(".sec-head .eyebrow", s), title: __mdq(".sec-head h2", s), sub: __mdq(".sec-head .sub", s) });
    const pri = el => { const p = el.querySelector(".pri"); return p ? [...p.classList].find(c => c !== "pri") : null; };
    const evs = el => __qa(".ev span", el).map(__md);
    const h1 = __q("header h1");
    return {
      eyebrow: __mdq("header .eyebrow"),
      h1: __md(h1), h1Accent: h1.querySelector("span") ? __md(h1.querySelector("span")) : null,
      intro: __mdq("header p"),
      meta: __qa("header .meta > span").map(__md),
      toc: __qa("nav.toc a").map(a => [a.getAttribute("href"), __md(a)]),
      priorities: { ...head(sec("priorities")), items: __qa(".top3 li", sec("priorities")).map(li => ({ title: __mdq("h3", li), body: __qa("p", li).map(__md).join(" ") })) },
      thirds: { ...head(sec("thirds")),
        zones: __qa(".zone").map(z => ({ name: __mdq(".eyebrow", z), title: __mdq("h3", z), pri: pri(z), text: __mdq(".z-pri", z), counts: __qa(".counts span", z).map(__md) })),
        attackDir: __mdq(".attack-dir"),
        blocks: __qa(".block").map(b => ({ name: __mdq(".block-intro .eyebrow", b), title: __mdq(".block-intro h3", b),
          intro: __qa(".block-intro > p", b).map(__md).join(" "), keepLabel: __mdq(".keep .eyebrow", b),
          keep: __qa(".keep li", b).map(__md),
          fixes: __qa(".fix", b).map(f => ({ pri: pri(f), title: __mdq("h4", f),
            body: __qa(".fix-body > p:not(.coach)", f).map(__md).join(" "), coach: __mdq(".coach", f), ev: evs(f) })) })) },
      units: { ...head(sec("units")), items: __qa(".unit").map(u => ({ name: __mdq("h3", u), pos: __mdq(".pos", u), verdict: __mdq(".verdict", u),
        items: __qa("li", u).map(li => { const c = li.cloneNode(true); c.querySelectorAll(".pri,.ev").forEach(x => x.remove());
          return { pri: pri(li), text: __md(c), ev: evs(li) }; }) })) },
      plan: { ...head(sec("plan")), items: __qa(".session").map(s => ({ slot: __mdq(".slot b", s), duration: __mdq(".slot span", s), title: __mdq("h3", s),
        items: __qa("li", s).map(__md), fixes: __mdq(".fixes-ref", s) })) },
      clips: { ...head(sec("clips")), cols: __qa("#clips thead th").map(__md), rows: __qa("#clips tbody tr").map(tr => __qa("td", tr).map(__md)) },
      footer: __qa("footer p").map(__md),
    };
  })()`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(HELPERS);
await page.route(/^https?:/, r => r.abort()); // no fonts needed

for (const slug of readdirSync(GAMES)) {
  const url = f => pathToFileURL(join(GAMES, slug, f)).href;
  const out = { slug };
  await page.goto(url("play-by-play.html"));
  out.pbp = await pbp(page);
  for (const n of ["EVENTS", "CFG", "KO", "HALF_LEN", "CLIPS"]) out.pbp[n] = await tryEval(page, n);
  await page.goto(url("match-report.html"));
  out.report = await report(page);
  for (const n of ["H1", "H2", "PHASES", "EVENTS", "CLIPS", "OFFICIAL", "KO"]) out.report[n] = await tryEval(page, n);
  await page.goto(url("coaches-breakdown.html"));
  out.coaches = await coaches(page);
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(out, null, 1));
  console.log(slug, out.pbp.EVENTS?.length, "events");
}
await browser.close();
