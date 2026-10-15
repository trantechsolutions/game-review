# DFC Game Film: Technical Log

Engineering record per push, newest first.

## 2026-10-15 — Breakdowns from a video link, stats credited to Ollie (6e3ecee..b1394ad)

- `tools/reeplayer.mjs`: `link.reeplayer.com` → branch.io page → `share.reeplayer.com/shared/<id>`; reads `file_url` (Mux `highest.mp4`, 1080p), `og:title`, `duration`. Downloads to `~/Downloads/reeplayer_<date>_<hhmm>/full_game.mp4` via a `.part` file with HTTP Range resume; `--info` resolves only. Last stdout line is JSON.
- `tools/scan_tape.py` (numpy + ffmpeg): `cues` decodes mono 16 kHz audio; whistle = spectral peak 3–4.8 kHz, ≥38 dB above band median, ≥90% of energy in 1.5–5 kHz, ≥100 ms, runs merged within 1.5 s (`long` ≥0.5 s). Crowd = 0.5 s RMS minus a 60 s rolling median, smoothed over 3 s, top 30 spaced 20 s apart. `sheets` tiles frames (`--at` or `--from/--to`, default 2 s, 5×4) with drawtext timestamps. `chunks` stream-copies the 290/300 s working files in the existing `clip_NN_<mm-ss>_to_<mm-ss>.mp4` naming and prints `video.workingClips`.
- Tuned on the 2026-10-11 tape: whistles at both kick-offs, half time, all three goal restarts and the 37' yellow card; crowd peaks on two of three goals.
- Stats attribution Reeplayer → Ollie: comments in `app/src/schema.ts` and `app/src/lib/time.ts`; game data (private) updated in two games (44 strings EN/ES). `public/` rebuilt.
- Analyst agent (local, excluded from git) now takes a link plus Ollie stats; the events log is optional.
- Verified: 20 unit tests, `npm run build` (4 games validated, 23 clips, 406 MB), e2e EN/ES pass.
- Rollback: `git revert b1394ad 6e3ecee`, `npm run build`, push.

## 2026-10-12 — Coaches-only breakdown and a re-cut save clip (f3d2a85..f3d2a85)

- `tools/build.mjs`: the published game file omits `coaches`. `{coaches}` is sealed to `opaque(nameKey, coaches/<slug>.json)` with `HMAC(PBKDF2(coach pw, tools/notes-kdf.json), "dfc-coach content")`. The build requires `private/.coach-password` (or `COACH_PASSWORD`) and rejects it if it equals the team password. The manifest gains `coachFile`.
- App: `PublicGame` and `CoachContent` schemas. `notesCrypto` derives `contentRaw`, and `notes.tsx` stores it and exposes `contentKey` (stored keys without it are dropped). `site.loadCoaches` and the `useCoaches` hook; `Coaches` shows a locked screen; game-list and menu links hide unless unlocked. Notes KDF moved to `tools/notes-kdf.json`.
- Verified: the team key opens 28 public files with no breakdown content, and opens 0 of 4 coach files. e2e covers the locked state, a wrong then right coach password, and all pages in EN/ES.
- Clip `2026-10-03-krewe/03-gk-fast-break-save` re-timed from 58:40–59:15 to 58:00–58:35 (only that clip re-cut). Note: the 5-minute chunk files run about 10 s ahead of the full video.
- Rollback: `git revert f3d2a85`, `npm run build`, push.

## 2026-10-12 — Positions as acronyms (55fa811..55fa811)

- `app/src/lib/positions.ts`: acronym → {en, es} full names, plus `splitPositions()`. `RichText` wraps matches in `<abbr class="pos-abbr" data-full>` with a CSS tooltip and screen-reader text.
- Game data: one-off `tools/legacy/acronyms.mjs` rewrote 385 Text values (unit names exempt).
- `tools/validate.ts`: rejects spelled-out positions in EN/ES (unit names exempt). Agent instructions updated to match.
- Tests: 20 unit tests (added acronym splitting and the validator rule); e2e passes in EN/ES.
- Fix: two regexes had a literal backspace where `\b` was intended (from a scripted edit); repaired and scanned for control characters.
- Rollback: `git revert 55fa811`, `npm run build`, push.

## 2026-10-12 — Unit review page (6c36dbb..6c36dbb)

- `app/src/schema.ts`: required `unitReviews` = `{ intro, units: [defense, midfield, attack] }`. Each unit has `positions`, `summary`, `positives[]`/`negatives[]` (`{text, ev}`) and `improvements[]` (`{area, title, detail, ev}`, `area` ∈ `IMPROVEMENT_AREAS`). A refine enforces the unit order.
- `app/src/pages/UnitReview.tsx` (route `/game/:slug/units`), plus the game-list button, i18n keys (`unit_*`, `area_*`), styles under `.pg-units`, and note anchors `section:units/<unit>`.
- `tools/validate.ts`: every unit-review `ev` must match a logged event (`<h>H <clock>`).
- Tests: 18 unit tests (added evidence and unit-order checks). The e2e covers 20 pages in EN/ES; it caught an untranslated position label, which was fixed.
- `.gitignore`: `.vite/` dev cache.
- Rollback: `git revert 6c36dbb`, `npm run build`, push.

## 2026-10-12 — React app, Spanish and coach notes (029f974..cc76569)

- **App:** `app/` (Vite 7, React 19, TypeScript, react-router hash routing). `app/src/schema.ts` (zod) defines the game file; every prose field is `{en, es}` with `**bold**`/`*italic*`/`mono` markup only (no HTML rendered from data). Pages: `pages/{PlayByPlay,MatchReport,Coaches,Highlights,GameList}.tsx`; UI strings in `i18n.tsx`. Video times, working-clip refs, game minutes, per-half stats and the shot timeline are computed from `video` settings and `events`.
- **Data:** `private/data/games/<slug>.json`, `private/data/site.json`, clips in `private/clips/<slug>/`. The four games were scraped from the old pages (`tools/legacy/`, Playwright) and translated with `tools/i18n.mjs` (export/import, warns on markup or number drift). Old pages kept in `private/legacy/`.
- **Build:** `npm run build` = `tsc` + `vite build` + `tools/build.mjs`. It validates (`tools/validate.ts`: schema, unique ids, phase refs, Spanish present and not copied, clip files under 95 MB), seals games, the manifest and clips (`tools/lib/seal.mjs`, unchanged AES-GCM/PBKDF2 scheme), and fails if the team name, an opponent, a slug or a clip id appears in readable output. The browser derives the manifest's opaque name from the key. Clips keep their old sealed path, so all 23 are byte-identical (no re-upload). The team's short name moved into the encrypted manifest.
- **Coach notes:** `tools/notes/setup.sql` creates `coach_notes` and `coach_key` (RLS on, no grants to anon) and security-definer RPCs `notes_check/list/save/delete/set_key` that check `sha256(p_key)`. It also grants schema usage to the API roles. The client (`app/src/notes.tsx`, `lib/notesCrypto.ts`) derives the access key and the AES key from the coach password with PBKDF2 then HMAC; scope = HMAC(slug). `tools/notes/coach.ts` covers `setup-sql`, `check` and `rotate`.
- **Other:** `tools/make_highlights.py` reads clips from the game file and no longer writes pages. `tools/assets/` removed. `.gitignore` no longer ignores `*.ts` (it was hiding TypeScript; video is `*.m2ts` / `clips/**/*.ts`). `pages.yml` allows only `index.html`, `assets/*.js|css` and `*.bin`, and rejects any `.bin` that parses as JSON or has an MP4 header. `npm run dev` serves `public/*.bin` so the gate works locally.
- **Tests:** `npx vitest run` passes 16 tests covering time maths against the old pages, build-to-browser crypto, note crypto and validation. `node tools/e2e.mjs` passes: unlock, 16 pages in EN/ES with no leftover English, clip decrypt, refresh, quick links, 375 px width, coach-area rejection, lock. `coach.ts check` passes against the live Supabase project.
- **Rollback:** `git revert` the merge and push; the previous encrypted pages return. Notes in Supabase are unaffected.

## 2026-10-12 — Players identified by position only (796bcdb..796bcdb)

- `private/` (gitignored): names and `#<n>` jersey references replaced with positions in every `play-by-play`, `match-report`, `coaches-breakdown` and `highlights` page, and in `private/highlights.json`. 9 clips renamed (e.g. `02-<name>-16` → `02-st-16`), not re-cut.
- `public/`: rebuilt with `node tools/build.mjs` (17 pages, 23 clips, 402 MB). 17 pages re-encrypted, 9 `.bin` added and 9 removed because the renames change the opaque names.
- Checks: a grep of `private/` for every inventoried name and `#<n>` pattern returns nothing; every clip link resolves.
- Known leftover: `docs/living/STAKEHOLDER.md` entry 2026-10-11 (6d4893d) names a player; not edited because the log is append-only.
- Rollback: `git revert 796bcdb` and push. The original wording survives only in the Downloads source folders.

## 2026-10-11 — Game 3 film added: DFC 2–1 BRSC (6d4893d..6d4893d)

- `public/`: rebuilt with `node tools/build.mjs` (17 pages, 23 clips). 4 new pages and 6 new `.bin` clips for slug `2026-10-11-brsc`. 13 existing pages re-encrypted because the game list and routes changed.
- Source (gitignored): `private/site/games/2026-10-11-brsc/` and a new entry in `private/highlights.json`. Clips were cut from `full_game.mp4`, each under 32 MB.
- Checks: every clip linked from `highlights.html` exists, and no published file name contains readable text. `git grep -i brsc` hits one base64 run inside `public/25a33f0095a6df57ed8f.html` by chance; it is ciphertext, not a leak.
- Rollback: `git revert 6d4893d` and push, or remove the game from `private/`, rebuild and push.

## 2026-10-11 — Consistent layout after refresh and clip load (37396dd..37396dd)

- `tools/assets/unlock.js`: `show()` now waits for `DOMContentLoaded` before `document.open/write/close`. On the saved-key path the write ran during gate parsing, so it inserted into the gate document instead of replacing it. `gate.css` (`body{display:grid;place-items:center}`) stayed applied, which shifted the game list and sized highlight frames to their content until the video loaded.
- `private/site/index.html`: the highlights icon `content` escape was a literal U+0015 control character; it is now `"B6"`.
- Tests: a Playwright (Chrome) script ran login, measure, reload, measure, then highlights, measure, Load, measure. Body styles, stylesheets and element boxes were identical across login and refresh, and highlight frames stayed 550×367 before and after Load.
- Rollback: `git revert` this commit, rebuild and push.

## 2026-10-11 — Publish encrypted site with opaque names (c3fbaab..c3fbaab)

- `tools/build.mjs`: output is flat. Each file is named HMAC-SHA256(nameKey, source path)[:20] + `.html` or `.bin`; `index.html` keeps its name. A `DFC_ROUTES` map (source path → name) and `DFC_SELF` are injected into each page before encryption. Gate and asset URLs are root-relative to the flat folder.
- `tools/assets/media.js`: resolves every `a[href]` and `video[data-enc-src]` against `DFC_SELF` and rewrites it through `DFC_ROUTES`.
- `.github/workflows/pages.yml`: allows only `*.bin`, `*.html`, `assets/`, `robots.txt` and `.nojekyll`, requires a flat `public/`, and requires every page to carry an encrypted payload.
- Tests: a WebCrypto decrypt of every page with the real password resolved 41 of 41 links and clips (0 broken). A sample clip round-trips byte-identical. A rebuild produces an identical git tree.
- Rollback: `git revert` this commit, rebuild and push. Never commit `private/`.

## 2026-10-11 — Switch to local encryption, public repo (f235f62..f235f62)

- Moved `site/` to `private/site/` and `tools/highlights.json` to `private/highlights.json`. `private/` is gitignored, as is every `*.mp4`.
- `tools/build.mjs`: outputs to `public/`. Password comes from `private/.site-password` or the `SITE_PASSWORD` env var. IV = HMAC-SHA256(HMAC(key, label), path ‖ 0 ‖ plaintext)[:12], so output is deterministic per content and never reuses an IV across different plaintexts. Gate page no longer names the team.
- `.github/workflows/pages.yml`: no build step and no secret. It checks that `public/` holds only `.enc` files, encrypted gate pages and `assets/`, then deploys `public/`. Actions are bumped to checkout@v5 and upload-pages-artifact@v4.
- History rewritten: an orphan commit replaces eb8657f, which contained plaintext under `site/`. Pages `build_type` was set to `workflow`, which stops the branch-root deploy that was serving `README.md` and raw clips.
- Rollback: none recommended. Re-committing `private/` would republish plaintext.

## 2026-10-11 — Game film site launched (initial)

**Added**
- `site/`: plain source. `index.html` (game list, `GAMES` array), `games/<slug>/{play-by-play,coaches-breakdown,match-report,highlights}.html`, `games/<slug>/clips/*.mp4`. The report pages are artifact HTML fragments, wrapped into full documents at build time.
- `tools/make_highlights.py`: cuts the clips in `tools/highlights.json` from the full-game video. 720p, h264_nvenc VBR cq 29 at 1.6 Mbps (or `--cpu` libx264 crf 26), AAC 96k, faststart. Refuses clips over 95 MB. Writes `highlights.html` and deletes clips no longer listed.
- `tools/build.mjs`: `SITE_PASSWORD` → PBKDF2-SHA256 (600k iterations, salt in `tools/kdf.json`) → AES-256-GCM. Pages become gate documents with a base64 `iv‖ct‖tag` payload. Clips become `*.mp4.enc` in the same layout. Injects `assets/media.js` into every page and writes `robots.txt` (disallow all) and `.nojekyll`. Exits 1 if the secret is missing.
- `tools/assets/unlock.js`: derives the key with WebCrypto, decrypts and `document.write`s the page. Keeps the raw key in sessionStorage, plus localStorage when "Keep me signed in" is ticked. Drops a stored key that no longer decrypts.
- `tools/assets/media.js`: fetches and decrypts `video[data-enc-src]` into a Blob URL when Load is pressed. `[data-lock]` clears the stored key.
- `.github/workflows/pages.yml`: on push to `main` or manual run, builds with Node 22 and deploys with `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`.

**Verified locally.** A test build encrypted 13 pages and 17 clips (316 MB). WebCrypto decryption of a page and a clip round-trips byte-identical. A wrong password is rejected. No plaintext names appear in the gate documents. A build without `SITE_PASSWORD` exits 1.

**Rollback.** Disable Pages under Settings → Pages, or revert the commit and re-run the workflow.
