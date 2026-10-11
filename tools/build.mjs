// Encrypts private/site/ into public/ on this PC. Only public/ is committed and published.
//
// Every page becomes a small password gate holding its own AES-256-GCM ciphertext; the browser
// derives the key from the password (PBKDF2-SHA256) and swaps the gate for the real page.
// Every .mp4 becomes <name>.mp4.enc and is decrypted in the browser only when someone presses Load.
//
// The IV is an HMAC of the file's path and content, so an unchanged file encrypts to identical
// bytes and git sees no change; a changed file always gets a fresh IV.
//
//   node tools/build.mjs        (password from private/.site-password, or SITE_PASSWORD)
import { createCipheriv, createHmac, pbkdf2Sync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "private", "site");
const OUT = join(ROOT, "public");
const PW_FILE = join(ROOT, "private", ".site-password");
const KDF = JSON.parse(readFileSync(join(ROOT, "tools", "kdf.json"), "utf8"));

const password = process.env.SITE_PASSWORD
  || (existsSync(PW_FILE) ? readFileSync(PW_FILE, "utf8").replace(/^﻿/, "").replace(/\r?\n$/, "") : "");
if (!password) {
  console.error(`No password. Put it on one line in ${relative(ROOT, PW_FILE)} (never committed).`);
  process.exit(1);
}
if (password.length < 12) console.warn("warning: the password is shorter than 12 characters; anyone can download the encrypted files and guess offline.");

const key = pbkdf2Sync(password, Buffer.from(KDF.salt, "base64"), KDF.iterations, 32, "sha256");
const ivKey = createHmac("sha256", key).update("dfc-film iv derivation").digest();

// iv (12 bytes) || ciphertext || GCM tag (16 bytes): the layout WebCrypto's AES-GCM decrypt expects after the iv.
function seal(path, buf) {
  const iv = createHmac("sha256", ivKey).update(path).update("\0").update(buf).digest().subarray(0, 12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()]);
}

// Pages exported from Claude artifacts are fragments; give them a full document before encrypting.
function asDocument(html, rel) {
  const media = `<script src="${rel}assets/media.js"></script>`;
  if (/<!doctype/i.test(html)) return html.replace(/<\/body>/i, `${media}</body>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<meta name="robots" content="noindex, nofollow">` +
    // The reset the artifact viewer used to supply.
    `<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>` +
    `</head><body>${html}\n${media}</body></html>`;
}

const gate = (payload, rel) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Game Film</title>
<link rel="stylesheet" href="${rel}assets/gate.css">
</head>
<body>
<main class="gate" id="gate" hidden>
  <p class="eyebrow">Team only</p>
  <h1>Game <span>film</span></h1>
  <form id="unlock">
    <label for="pw">Team password</label>
    <input id="pw" name="pw" type="password" autocomplete="current-password" required autofocus>
    <label class="remember"><input id="remember" type="checkbox"> Keep me signed in on this device</label>
    <button type="submit" id="go">Open</button>
    <p class="msg" id="msg" role="alert"></p>
  </form>
</main>
<script type="application/json" id="kdf">${JSON.stringify({ salt: KDF.salt, iterations: KDF.iterations })}</script>
<script type="text/plain" id="payload">${payload}</script>
<script src="${rel}assets/unlock.js"></script>
</body>
</html>
`;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
}

if (!existsSync(SRC)) {
  console.error(`Nothing to build: ${relative(ROOT, SRC)} is missing.`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, "tools", "assets"), join(OUT, "assets"), { recursive: true });
writeFileSync(join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
writeFileSync(join(OUT, ".nojekyll"), "");

let pages = 0, clips = 0, bytes = 0;
for (const file of walk(SRC)) {
  const relPath = relative(SRC, file).split(sep).join("/");
  const rel = "../".repeat(relPath.split("/").length - 1);
  const dest = join(OUT, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  if (file.endsWith(".html")) {
    const html = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const sealed = seal(relPath, Buffer.from(asDocument(html, rel), "utf8"));
    writeFileSync(dest, gate(sealed.toString("base64"), rel));
    pages++;
  } else if (file.endsWith(".mp4")) {
    const sealed = seal(relPath, readFileSync(file));
    writeFileSync(dest + ".enc", sealed);
    clips++; bytes += sealed.length;
  } else {
    console.warn(`skipped (not .html or .mp4, so not published): ${relPath}`);
  }
}
console.log(`encrypted ${pages} pages and ${clips} clips (${(bytes / 1e6).toFixed(0)} MB) into public/`);
if (bytes > 950e6) console.warn("warning: public/ is close to GitHub Pages' 1 GB site limit.");
