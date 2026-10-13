// Browser check of a local build: unlock with the real password, open every page of every game in
// English and Spanish, fail on console errors or missing content. Screenshots go to private/e2e/.
//   npm run build && node tools/e2e.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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

  await page.setViewportSize({ width: 1280, height: 900 });

  // Lock clears the key.
  await page.getByRole("button", { name: /Bloquear|Lock/ }).click();
  await page.locator("#pw").waitFor({ timeout: 20000 });
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) { console.error(`✗ ${problems.length} problem(s):\n  ${problems.join("\n  ")}`); process.exit(1); }
console.log("✓ all pages render in English and Spanish");
