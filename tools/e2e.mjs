// Browser check of a local build: unlock with the real password, open every page of every game in
// English and Spanish, fail on console errors or missing content. Screenshots go to private/e2e/.
//   npm run build && node tools/e2e.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "private", "e2e");
mkdirSync(SHOTS, { recursive: true });
const password = (process.env.SITE_PASSWORD || readFileSync(join(ROOT, "private", ".site-password"), "utf8")).replace(/^﻿/, "").trim();
const coachPassword = (process.env.COACH_PASSWORD || readFileSync(join(ROOT, "private", ".coach-password"), "utf8")).replace(/^﻿/, "").trim();
const PORT = 8123;

const server = spawn("python", ["-m", "http.server", String(PORT), "-d", join(ROOT, "public"), "--bind", "127.0.0.1"], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1200));
const base = `http://127.0.0.1:${PORT}/`;

const problems = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let expect404 = true; // the wrong-password attempt asks for a manifest that doesn't exist
  let expect400 = false; // the wrong coach password is refused (or, before setup, the notes functions don't exist)
  page.on("console", m => {
    if (m.type() !== "error" || /fonts\.g/.test(m.text()) || (expect404 && /404/.test(m.text())) || (expect400 && /\b4\d\d\b/.test(m.text()))) return;
    problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));

  await page.goto(base);
  await page.fill("#pw", "wrong password 123");
  await page.click("button[type=submit]");
  await page.getByRole("alert").filter({ hasText: /didn't work|no funciona/ }).waitFor({ timeout: 30000 });

  expect404 = false;
  await page.fill("#pw", password);
  await page.click("button[type=submit]");
  await page.locator(".pg-list .game").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(SHOTS, "list-en.png"), fullPage: true });
  const slugs = await page.locator(".pg-list .links a.pbp").evaluateAll(as => as.map(a => a.getAttribute("href").split("/")[2]));
  console.log(`unlocked; ${slugs.length} games`);

  // With only the team password, the coaches' breakdown is hidden and locked.
  if (await page.locator(".pg-list .links a.coach").count()) problems.push("game list shows the coaches' breakdown before the coach area is unlocked");
  await page.goto(`${base}#/season`);
  await page.locator(".pg-season .themes-locked").waitFor({ timeout: 30000 });
  if (await page.locator(".pg-season .themes li").count()) problems.push("season themes shown without the coach password");
  await page.goto(`${base}#/game/${slugs[0]}/coaches`);
  await page.locator(".locked").waitFor({ timeout: 20000 });
  if (await page.locator(".pg-coaches").count()) problems.push("coaches' breakdown rendered without the coach password");
  if (await page.locator(".appbar nav a", { hasText: /Coaches' breakdown/ }).count()) problems.push("menu shows the coaches' breakdown while locked");

  // The coach area refuses a wrong coach password, then opens with the right one.
  expect400 = true;
  await page.locator(".locked button").click();
  await page.fill("#coach-pw", "not the coach password");
  await page.locator(".dialog button[type=submit]").click();
  await page.locator(".dialog .msg").filter({ hasText: /didn't work|no funciona/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500); // console events arrive a little after the response
  expect400 = false;
  await page.fill("#coach-pw", coachPassword);
  await page.locator(".dialog button[type=submit]").click();
  await page.locator(".pg-coaches .zone").first().waitFor({ timeout: 30000 });
  if (!(await page.locator(".appbar nav a", { hasText: /Coaches' breakdown/ }).count())) problems.push("menu hides the coaches' breakdown after unlocking");
  console.log("coaches' breakdown: locked with the team password, opens with the coach password");

  const checks = {
    "play-by-play": async () => { const n = await page.locator(".pg-pbp tbody tr").count(); if (n < 5) throw new Error(`${n} rows`); },
    report: async () => { await page.locator(".pg-report .phase").first().waitFor(); if (!(await page.locator(".pg-report svg circle").count())) throw new Error("empty timeline"); },
    coaches: async () => { if ((await page.locator(".pg-coaches .zone").count()) !== 3) throw new Error("zones"); },
    highlights: async () => { if (!(await page.locator(".pg-hl figure").count())) throw new Error("no clips"); },
    units: async () => { if ((await page.locator(".pg-units section.sec").count()) !== 3) throw new Error("expected 3 unit reviews"); },
  };

  for (const lang of ["en", "es"]) {
    if (lang === "es") { await page.goto(base + "#/"); await page.getByRole("button", { name: /Ver en español/ }).click(); await page.screenshot({ path: join(SHOTS, "list-es.png"), fullPage: true }); }
    for (const slug of slugs) for (const [p, check] of Object.entries(checks)) {
      await page.goto(`${base}#/game/${slug}/${p}`);
      try {
        await page.locator(`.pg-${{ "play-by-play": "pbp", highlights: "hl" }[p] ?? p}`).waitFor({ timeout: 20000 });
        await check();
        // A position acronym directly inside a grid or flex box splits its sentence onto separate lines.
        const split = await page.evaluate(() => [...document.querySelectorAll("abbr.pos-abbr")]
          .filter(a => /grid|flex/.test(getComputedStyle(a.parentElement).display))
          .map(a => `${a.parentElement.tagName.toLowerCase()}.${[...a.parentElement.classList].join(".")}`));
        if (split.length) problems.push(`${slug}/${p}: text breaks around positions in ${[...new Set(split)].join(", ")}`);
        const htmlLang = await page.evaluate(() => document.documentElement.lang);
        if (htmlLang !== lang) throw new Error(`html lang ${htmlLang}`);
        // Untranslated English sentences left on a Spanish page.
        if (lang === "es") {
          const english = await page.evaluate(() => [...document.querySelectorAll("main p, main h2, main h3, main li, th, .eyebrow, button")]
            .map(e => e.textContent.trim()).filter(s => /\b(the|and|with|from|after|was|were|our)\b/.test(s) && !/[áéíóúñ¿¡]/i.test(s)).slice(0, 3));
          if (english.length) problems.push(`${slug}/${p} [es]: English text: ${english.join(" | ").slice(0, 300)}`);
        }
      } catch (e) { problems.push(`${slug}/${p} [${lang}]: ${e.message}`); }
      await page.screenshot({ path: join(SHOTS, `${slug}-${p}-${lang}.png`), fullPage: true });
    }
  }

  // Section quick links scroll within the page and keep the route.
  for (const [p, id] of [["coaches", "units"], ["report", "numbers"]]) {
    await page.goto(`${base}#/game/${slugs[0]}/${p}`);
    await page.locator("nav.toc button").first().waitFor();
    const before = page.url();
    await page.locator("nav.toc button").nth(p === "coaches" ? 2 : 3).click();
    await page.waitForTimeout(1500); // smooth scroll
    const { top, atBottom } = await page.evaluate(i => ({
      top: document.getElementById(i).getBoundingClientRect().top,
      atBottom: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2,
    }), id);
    if (page.url() !== before) problems.push(`${p} quick link changed the page to ${page.url()}`);
    if (Math.abs(top) > 40 && !(atBottom && top > 0)) problems.push(`${p} quick link didn't scroll to #${id} (top ${Math.round(top)})`);
  }

  // With a roster, the breakdown lists it and position tooltips name who could have made the play.
  const rosterFile = join(ROOT, "private", "data", "roster.json");
  const roster = existsSync(rosterFile) ? JSON.parse(readFileSync(rosterFile, "utf8")).players : [];
  if (roster.length) {
    await page.goto(`${base}#/game/${slugs[0]}/coaches`);
    await page.locator(".pg-coaches #roster tbody tr").first().waitFor({ timeout: 20000 });
    const rows = await page.locator(".pg-coaches #roster tbody tr").count();
    if (rows !== roster.length) problems.push(`roster shows ${rows} of ${roster.length} players`);
    const tips = await page.locator(".pg-coaches main abbr.pos-abbr").evaluateAll(a => a.map(x => x.dataset.full));
    // With a lineup for this game the tooltips name who played there; without one, who could have.
    if (!tips.some(t => /(could be|pudo ser|played there|jugó ahí):\n/.test(t))) problems.push("no position tooltip lists players");
    // The lineup pitch: eleven markers, and dragging the timeline to the end moves through the changes.
    if (await page.locator(".pg-coaches .lp").count()) {
      const marks = await page.locator(".lp-mark").count();
      if (marks !== 11) problems.push(`lineup pitch shows ${marks} players at kickoff`);
      const first = await page.locator(".lp-mark .name").allTextContents();
      const range = page.locator(".lp-track input[type=range]");
      await range.focus();
      await page.keyboard.press("End");
      await page.waitForTimeout(600);
      const last = await page.locator(".lp-mark .name").allTextContents();
      if (first.join() === last.join()) problems.push("lineup pitch didn't change when the timeline moved");
      await page.locator(".pg-coaches .lp").screenshot({ path: join(SHOTS, "lineup-pitch-end.png") });
      await page.keyboard.press("Home");
      await page.waitForTimeout(600); // markers glide to their spots
      await page.locator(".pg-coaches .lp").screenshot({ path: join(SHOTS, "lineup-pitch.png") });
    }
    await page.locator(".pg-coaches .unit-head abbr.pos-abbr").first().hover();
    await page.screenshot({ path: join(SHOTS, "roster-tooltip.png") });
    console.log(`roster: ${rows} players, ${tips.filter(t => /(could be|pudo ser|played there|jugó ahí):/.test(t)).length} position tooltips name players`);
  }

  // The season overview sums every game.
  await page.goto(`${base}#/season`);
  await page.locator(".pg-season .r-row").first().waitFor({ timeout: 30000 });
  const seasonRows = await page.locator(".pg-season .r-row").count();
  if (seasonRows !== slugs.length) problems.push(`season overview lists ${seasonRows} of ${slugs.length} games`);
  if (!(await page.locator(".pg-season .themes li").count())) problems.push("season overview has no recurring themes");
  if ((await page.locator(".pg-season .nums tbody tr").count()) !== slugs.length) problems.push("season numbers table is missing games");
  await page.screenshot({ path: join(SHOTS, "season.png"), fullPage: true });
  console.log(`season overview: ${seasonRows} games`);

  // The squad page lists every rostered player (coach area is unlocked by now); each player page opens.
  if (roster.length) {
    await page.goto(`${base}#/players`);
    await page.locator(".pg-players .squad tbody tr").first().waitFor({ timeout: 30000 });
    const n = await page.locator(".pg-players .squad tbody tr").count();
    if (n !== roster.length) problems.push(`players page lists ${n} of ${roster.length} players`);
    await page.screenshot({ path: join(SHOTS, "players.png"), fullPage: true });
    await page.locator(".pg-players .squad tbody th a").first().click();
    await page.locator(".pg-players .strip h1").waitFor({ timeout: 20000 });
    await page.screenshot({ path: join(SHOTS, "player.png"), fullPage: true });
    console.log(`players: ${n} listed`);
  }

  // One clip: load, decrypt, play.
  await page.goto(`${base}#/game/${slugs[0]}/highlights`);
  await page.locator(".pg-hl .frame button").first().click();
  await page.waitForFunction(() => document.querySelector(".pg-hl video")?.src?.startsWith("blob:"), null, { timeout: 60000 });
  const dur = await page.locator(".pg-hl video").first().evaluate(v => new Promise(r => v.readyState >= 1 ? r(v.duration) : v.addEventListener("loadedmetadata", () => r(v.duration))));
  if (!(dur > 1)) problems.push(`clip duration ${dur}`);
  console.log(`clip decrypted, ${Math.round(dur)} s`);

  // Refresh keeps the session (sessionStorage) and the language.
  await page.reload();
  await page.locator(".pg-hl").waitFor({ timeout: 20000 });

  // Mobile width: no horizontal page scroll.
  await page.setViewportSize({ width: 375, height: 800 });
  for (const p of ["play-by-play", "report", "coaches", "highlights"]) {
    await page.goto(`${base}#/game/${slugs[0]}/${p}`);
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${p} @375px: page scrolls sideways by ${over}px`);
    await page.screenshot({ path: join(SHOTS, `mobile-${p}.png`), fullPage: false });
  }
  await page.goto(`${base}#/season`);
  await page.locator(".pg-season .r-row").first().waitFor({ timeout: 30000 });
  const seasonOver = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (seasonOver > 1) problems.push(`season @375px: page scrolls sideways by ${seasonOver}px`);
  await page.screenshot({ path: join(SHOTS, "mobile-season.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });

  // Lock clears the key.
  await page.getByRole("button", { name: /Bloquear|Lock/ }).click();
  await page.locator("#pw").waitFor({ timeout: 20000 });

  // Scorekeeper mode, on a phone held sideways: its own password, then a game logged the possession way.
  // Supabase is blocked so the run never writes to the real stat log; the screen says "Not sent".
  const keeperFile = join(ROOT, "private", ".keeper-password");
  if (existsSync(keeperFile)) {
    const keeperPassword = readFileSync(keeperFile, "utf8").replace(/^\uFEFF/, "").trim();
    const kctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await kctx.route(/supabase\.co/, r => r.abort());
    const kp = await kctx.newPage();
    // The wrong password asks for a roster that doesn't exist (404); blocked sync calls fail.
    kp.on("console", m => { if (m.type() === "error" && !/\b40\d\b|ERR_FAILED|fonts\.g/.test(m.text())) problems.push(`keeper console: ${m.text()}`); });
    kp.on("pageerror", e => problems.push(`keeper pageerror: ${e.message}`));
    await kp.goto(`${base}#/keep`);
    if (!(await kp.locator(".kp-rotate").count())) problems.push("keeper: held upright, it doesn't ask for the phone to be turned");
    await kp.setViewportSize({ width: 844, height: 390 });
    await kp.fill("#kp-pw", password);
    await kp.click("button[type=submit]");
    await kp.getByRole("alert").filter({ hasText: /didn't work/ }).waitFor({ timeout: 30000 });
    await kp.fill("#kp-pw", keeperPassword);
    await kp.click("button[type=submit]");
    await kp.locator(".kp-new").click({ timeout: 30000 });
    await kp.getByLabel("Opponent").fill("E2E Check");
    const next = () => kp.locator(".kp-top .kp-next").click();
    await next();
    await kp.getByRole("button", { name: "7v7" }).click(); await next(); // players
    await next(); await next(); await next();                              // advanced, 30 min, our goal on the left
    await kp.getByRole("button", { name: "2-3-1" }).click(); await next();
    await kp.getByRole("button", { name: "Fill from squad" }).click();
    if ((await kp.locator(".kp-pill.slot:not(.empty)").count()) !== 7) problems.push("keeper: Fill from squad didn't fill 7 spots");
    await next();
    const pills = kp.locator(".kp-pitch .kp-pill.us");
    await pills.nth(6).click();
    await kp.getByRole("button", { name: "Start recording" }).click();
    await pills.nth(4).click(); // pass
    await pills.nth(6).click(); // pass back
    if ((await kp.locator(".kp-chain").textContent()) !== "+2") problems.push("keeper: the pass chain isn't +2");
    // Swipe the striker to Shot: taken from the box, into the top corner, a goal, assisted.
    const b = await pills.nth(6).boundingBox();
    await kp.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await kp.mouse.down();
    await kp.mouse.move(b.x + b.width / 2 + 30, b.y + 10, { steps: 4 });
    const z = await kp.locator(".kp-zone.z-shot").boundingBox();
    await kp.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 6 });
    await kp.mouse.up();
    const sf = await kp.locator(".kp-pick").boundingBox();
    await kp.mouse.click(sf.x + sf.width * 0.5, sf.y + sf.height * 0.3);
    const gm = await kp.locator(".kp-pick.goal").boundingBox();
    await kp.mouse.click(gm.x + gm.width * 0.75, gm.y + gm.height * 0.4);
    await kp.getByRole("button", { name: /Goal$/ }).click();
    await kp.locator(".kp-picks .kp-pill.suggest").click();
    if (!/1–0/.test(await kp.locator(".kp-score").textContent())) problems.push("keeper: the goal didn't count");
    await kp.locator(".kp-head .kp-pill.opp").last().click(); // their kickoff
    await kp.locator(".kp-head .kp-pill.opp").last().click(); // tapped again: their pass
    if (!/completed a pass/.test(await kp.locator(".kp-prompt").textContent())) problems.push("keeper: tapping the opponent again isn't their pass");
    // Out over a touchline, our throw-in, then their foul.
    await kp.getByRole("button", { name: /Out$/ }).click();
    const lp = await kp.locator(".kp-pick.line").boundingBox();
    await kp.mouse.click(lp.x + lp.width * 0.4, lp.y + lp.height * 0.05);
    await kp.locator(".kp-step-head .kp-next").click();
    await kp.locator(".kp-taker").first().locator(".kp-pill").first().click();
    if (!(await kp.getByRole("button", { name: "Illegal throw-in" }).count())) problems.push("keeper: no illegal throw-in button after a throw-in");
    await pills.nth(2).click();
    await kp.locator(".kp-actions .kp-pill.team").click(); // a pass we couldn't see the end of
    if (!/to My Team/.test(await kp.locator(".kp-prompt").textContent())) problems.push("keeper: My Team isn't a pass to an unseen teammate");
    await kp.getByRole("button", { name: /Infractions$/ }).click();
    await kp.getByRole("button", { name: /Foul$/ }).click();
    await kp.locator(".kp-picks .kp-pill.opp").first().click();
    await kp.getByRole("button", { name: "Free kick" }).click();
    const swipe = async (loc) => {
      const r = await loc.boundingBox();
      await kp.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await kp.mouse.down();
      await kp.mouse.move(r.x + r.width / 2 + 30, r.y + 10, { steps: 4 });
      const zz = await kp.locator(".kp-zone.z-shot").boundingBox();
      await kp.mouse.move(zz.x + zz.width / 2, zz.y + zz.height / 2, { steps: 6 });
      await kp.mouse.up();
    };
    await kp.locator(".kp-head .kp-pill.opp").last().click(); // they win it
    await swipe(kp.locator(".kp-head .kp-pill.opp").last());
    await kp.getByRole("button", { name: "Skip" }).click();
    const gm2 = await kp.locator(".kp-pick.goal").boundingBox();
    await kp.mouse.click(gm2.x + gm2.width * 0.05, gm2.y + gm2.height * 0.6); // wide
    await kp.locator(".kp-step-head").filter({ hasText: "Where did the ball go out?" }).waitFor();
    const lp2 = await kp.locator(".kp-pick.line").boundingBox();
    await kp.mouse.click(lp2.x + lp2.width * 0.01, lp2.y + lp2.height * 0.3); // our goal line
    await kp.locator(".kp-step-head .kp-next").click();
    await kp.locator(".kp-taker").first().locator(".kp-pill").first().click(); // our keeper
    await kp.getByRole("button", { name: "Long kick" }).click();
    if (!/long goal kick/.test(await kp.locator(".kp-prompt").textContent())) problems.push("keeper: no long goal kick after the wide shot");
    await kp.locator(".kp-actions .kp-stats-btn").click();
    const feed = await kp.locator(".kp-sheet .kp-feed li").allTextContents();
    const want = ["Goal kick", "Shot", "Turnover", "Free kick", "Foul", "My Team", "Pass", "Throw-in", "E2E Check", "Kickoff", "Goal", "Pass", "Pass", "Kickoff"];
    if (feed.length !== want.length || want.some((w, i) => !feed[i].includes(w))) problems.push(`keeper: unexpected log ${JSON.stringify(feed)}`);
    await kp.getByRole("button", { name: "Close" }).click();
    await kp.locator(".kp-bar").getByRole("button", { name: "Undo" }).click();
    if ((await kp.locator(".kp-prompt").textContent()).includes("goal kick")) problems.push("keeper: Undo didn't remove the goal kick");
    // Voice: a dictated line (typed here, as Wispr Flow would) logs what the taps would.
    await kp.locator(".kp-bar").getByRole("button", { name: "Voice" }).click();
    const nums = await kp.locator(".kp-pitch .kp-pill.us .num").allTextContents();
    await kp.locator(".kp-voice .check").filter({ hasText: "Test only" }).locator("input").check();
    await kp.locator(".kp-voice-in").fill(`${nums[0]} to ${nums[1]}`);
    await kp.locator(".kp-voice-in").press("Enter");
    if (!/would log/.test(await kp.locator(".kp-voice-last").textContent())) problems.push("keeper: voice test mode didn't say what it would log");
    if (/recovered|passed/.test(await kp.locator(".kp-prompt").textContent())) problems.push("keeper: voice test mode logged something");
    await kp.locator(".kp-voice .check").filter({ hasText: "Test only" }).locator("input").uncheck();
    await kp.locator(".kp-voice-in").fill(`${nums[0]} to ${nums[1]}, them`);
    await kp.locator(".kp-voice-in").press("Enter");
    if (!/recovered the ball/.test(await kp.locator(".kp-prompt").textContent())) problems.push(`keeper: voice line didn't log: ${await kp.locator(".kp-voice-last").textContent()}`);
    await kp.locator(".kp-voice-in").fill("undo, undo, undo");
    await kp.locator(".kp-voice-in").press("Enter");
    // Lineup: tap two on the field to swap, then a field player and a bench player to sub; by voice too.
    const before = await kp.locator(".kp-pitch .kp-pill.us").allTextContents();
    await kp.locator(".kp-bar").getByRole("button", { name: "Substitutions" }).click();
    const field = kp.locator(".kp-sheet .kp-list").first().locator(".kp-li");
    const firstTwo = [await field.nth(1).locator("span").nth(1).textContent(), await field.nth(2).locator("span").nth(1).textContent()];
    await field.nth(1).click();
    await field.nth(2).click();
    await kp.locator(".kp-toast").filter({ hasText: firstTwo[0].split(" ")[0] }).waitFor({ timeout: 5000 });
    await kp.locator(".kp-sheet .kp-list").first().locator(".kp-li").nth(3).click();
    const benchName = await kp.locator(".kp-sheet .kp-list").nth(1).locator(".kp-li").first().locator("span").nth(1).textContent();
    await kp.locator(".kp-sheet .kp-list").nth(1).locator(".kp-li").first().click();
    await kp.getByRole("button", { name: "Close" }).click();
    if (!(await kp.locator(".kp-pitch .kp-pill.us").allTextContents()).some(x => x.includes(benchName.split(" ")[0].toUpperCase()) || x.includes(benchName.split(" ")[0]))) problems.push(`keeper: the lineup sheet didn't bring on ${benchName}`);
    await kp.locator(".kp-voice-in").fill(`swap ${firstTwo[0].split(" ")[0]} and ${firstTwo[1].split(" ")[0]}`);
    await kp.locator(".kp-voice-in").press("Enter");
    if (!/ST|LM|RM|CM|LCB|RCB|GK/.test(await kp.locator(".kp-voice-last").textContent()) || /✗/.test(await kp.locator(".kp-voice-last").textContent())) problems.push(`keeper: voice swap failed: ${await kp.locator(".kp-voice-last").textContent()}`);
    if (before.length !== (await kp.locator(".kp-pitch .kp-pill.us").count())) problems.push("keeper: the number on the field changed after a sub");
    await kp.screenshot({ path: join(SHOTS, "keeper-voice.png") });
    const over = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`keeper @844px: page scrolls sideways by ${over}px`);
    await kp.screenshot({ path: join(SHOTS, "keeper-live.png") });
    // A reload keeps everything: it lives on the phone until it's sent.
    await kp.reload();
    await kp.locator(".kp-score").filter({ hasText: "1–0" }).waitFor({ timeout: 20000 });
    // Deleting it from the games list removes it from this phone (and, once online, from the stat log).
    await kp.goto(`${base}#/keep`);
    await kp.locator(".kp-games li").filter({ hasText: "E2E Check" }).getByRole("button", { name: /Delete/ }).click();
    await kp.locator(".kp-sheet .kp-danger").click();
    if (await kp.locator(".kp-games li").filter({ hasText: "E2E Check" }).count()) problems.push("keeper: Delete didn't remove the game");
    if (!(await kp.evaluate(() => (localStorage.getItem("dfc-keeper-deleted") ?? "").includes("e2e-check")))) problems.push("keeper: the delete isn't queued for the stat log");
    await kctx.close();
    console.log("scorekeeper: asks to turn the phone, refuses the team password, logs passes, a shot with an assist, their passes, a pass to My Team, a throw-in, a foul, a wide shot out for a long goal kick, undoes, takes dictated lines, swaps and subs from the lineup sheet and by voice, survives a reload, deletes");
  } else console.log("scorekeeper: skipped (no private/.keeper-password)");
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) { console.error(`✗ ${problems.length} problem(s):\n  ${problems.join("\n  ")}`); process.exit(1); }
console.log("✓ all pages render in English and Spanish");
