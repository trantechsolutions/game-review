// Fetches a full-game tape from a Reeplayer share link. Nothing goes into the repository.
//
//   node tools/reeplayer.mjs <link>                 resolve and download to ~/Downloads/reeplayer_<date>_<hhmm>/full_game.mp4
//   node tools/reeplayer.mjs <link> --out <dir>     download into <dir> instead
//   node tools/reeplayer.mjs <link> --info          resolve only; print the JSON and download nothing
//
// link.reeplayer.com/<code> redirects (through a branch.io page) to share.reeplayer.com/shared/<id>.
// That page carries the game title, the duration and `file_url`, Mux's static `highest.mp4` (1080p),
// so no HLS variant has to be picked. Downloads go to a .part file and resume if interrupted.
// The last line printed is JSON: { share, title, recorded, duration, url, file }.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

const UA = { "user-agent": "Mozilla/5.0" };
const args = process.argv.slice(2);
const link = args.find(a => !a.startsWith("--"));
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = msg => { console.error(msg); process.exit(1); };
if (!link) fail("usage: node tools/reeplayer.mjs <reeplayer link> [--out <dir>] [--info]");

async function text(url) {
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) fail(`${url}: HTTP ${r.status}`);
  return { url: r.url, body: await r.text() };
}

// The short link lands on a branch.io page that names the share page instead of redirecting to it.
async function sharePage(url) {
  let page = await text(url);
  if (!page.url.includes("share.reeplayer.com/shared/")) {
    const m = page.body.match(/https:\/\/share\.reeplayer\.com\/shared\/[A-Za-z0-9]+/);
    if (!m) fail(`No share.reeplayer.com page found behind ${url}`);
    page = await text(m[0]);
  }
  return { share: page.url.split("?")[0], html: page.body };
}

const { share, html } = await sharePage(link);
const fileUrl = (html.match(/file_url:"(https:[^"]+)"/) || [])[1]
  || (html.match(/https:\/\/stream\.mux\.com\/[^"'\s]+\/highest\.mp4[^"'\s]*/) || [])[0];
if (!fileUrl) fail(`No video file on ${share}. The upload may still be processing; try again later.`);
const title = (html.match(/og:title" content="(?:.*? sent you )?([^"]*)"/) || [])[1]?.trim() || null;
const duration = Number((html.match(/duration:([\d.]+)/) || [])[1]) || null;
// The download name is game_YYYY_MM_DD_HH_MM: the recording's local start.
const stamp = fileUrl.match(/game_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
const recorded = stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]} ${stamp[4]}:${stamp[5]}` : null;
const info = { share, title, recorded, duration, url: fileUrl, file: null };

if (args.includes("--info")) { console.log(JSON.stringify(info)); process.exit(0); }

const dir = opt("--out") || join(homedir(), "Downloads", stamp ? `reeplayer_${stamp[1]}-${stamp[2]}-${stamp[3]}_${stamp[4]}${stamp[5]}` : `reeplayer_${share.split("/").pop()}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "full_game.mp4");
const part = `${file}.part`;
info.file = file.replace(/\\/g, "/");

const head = await fetch(fileUrl, { method: "HEAD", headers: UA });
const total = Number(head.headers.get("content-length")) || 0;
if (existsSync(file) && (!total || statSync(file).size === total)) {
  console.error(`Already downloaded: ${file}`);
  console.log(JSON.stringify(info));
  process.exit(0);
}

const have = existsSync(part) ? statSync(part).size : 0;
const r = await fetch(fileUrl, { headers: { ...UA, ...(have ? { range: `bytes=${have}-` } : {}) } });
if (!r.ok) fail(`Download failed: HTTP ${r.status}`);
const resumed = have > 0 && r.status === 206;
let done = resumed ? have : 0, shown = 0;
const mb = n => (n / 1048576).toFixed(0);
const progress = new Transform({
  transform(chunk, _, cb) {
    done += chunk.length;
    if (done - shown > 50 * 1048576) { shown = done; process.stderr.write(`\r${mb(done)} / ${mb(total)} MB`); }
    cb(null, chunk);
  },
});
await pipeline(Readable.fromWeb(r.body), progress, createWriteStream(part, { flags: resumed ? "a" : "w" }));
process.stderr.write("\n");
if (total && statSync(part).size !== total) fail(`Incomplete download (${statSync(part).size} of ${total} bytes). Run again to resume.`);
renameSync(part, file);
console.log(JSON.stringify(info));
