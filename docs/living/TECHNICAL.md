# DFC Game Film: Technical Log

Engineering record per push, newest first.

## 2026-10-21 — NOLA DFC Manager connection (129c8c6..129c8c6)

- **Supabase move:** `app/src/config.ts` points `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the manager's project. Notes and stat logs are copied over by `tools/manager/manager.ts migrate`.
- **Unlock from the manager:** `app/src/lib/unlock.ts` (`takeUnlock`, called first in `main.tsx`) reads keys from the URL fragment, stores them as a typed password would, and replaces the address. The keys come from the manager's `film_sites` table through `film_access()` (`nola-dfc-manager/sql/game_film_migration.sql`).
- **Scorekeeper under accounts:** `keeper.tsx` keeps an optional account token (`u` in the stored keys). With a token it calls `keeper_{append,list,forget}_as` (`p_token`); otherwise `keeper_*` (`p_key`). A `42501` with a token sets the new `SyncState` `"expired"`, shown by `SyncBadge` (`kp_syncExpired`). Needs `keeper_accounts_migration.sql`.
- **Schedule:** `schema.ts` adds `ScheduledGame`, `KeeperRoster.schedule` and `KeepSetup.eventId`. `tools/build.mjs` seals `private/data/schedule.json` into the keeper squad file and adds schedule opponents (3+ chars) to the leak check. `lib/schedule.ts` (`upcoming`) feeds a "From the team schedule" picker in `Keep.tsx` setup (`.kp-sched*` styles).
- **Roster and stats:** `lib/rosterMerge.ts` merges the manager roster into `roster.json` (adds `managerId`, renames in `lineups.json`, keeps departed players). `lib/playerStats.ts` builds per-season player stats from lineups, keeper logs and Ollie, one source per game.
- **Tooling:** `tools/manager/manager.ts` with `teams`, `setup-sql`, `migrate`, `link`, `check`, `roster`, `schedule`, `games` and `stats` (`--dry-run` where it writes). Reads `private/.manager.json` (service-role key, never committed). README section added.
- **Build output:** rebuilt `public/` (new hashed assets, re-sealed `.bin` files).
- **Not committed:** `docs/reference/` (local copy of the Ollie web app) stays out of the public repo.
- **Tests:** vitest 72/72 (was 56), adding schedule, roster merge and player stats cases.
- **Rollback:** revert 129c8c6 and run `npm run build`. Reverting `config.ts` alone points the app back at the old Supabase project, which still holds the data from before the migration.

## 2026-10-20 — Ollie game history and a clearer game layout (b9ef61f..b9ef61f)

- **Ollie history:**
  - `tools/ollie/pull.ts` serves `docs/reference/ollie-web`, waits for the Firebase user in IndexedDB, and reads via Firestore REST: `team` by `accounts.<uid>.exists`, `soccerGame` and `soccerStatSnapshot` by `teamId`, `calendarEntry` via batchGet, and `player` by `teamId`.
  - It translates short stat codes to `SoccerStatKeysObj` names, parsing `e.<name>="<code>"` from the saved bundle.
  - The score comes from `officiallyEndedGameSummaryStats.score`, the venue from `gameVenue` and names from `virtualAthleteAccount`.
  - It writes `private/data/ollie/{history,players,raw}.json`. `--from-raw` rebuilds without signing in.
- **Ollie helpers:** `app/src/lib/ollie.ts` holds the stat labels, `fmtStat`, `seasonOf`, `matchInApp`, `summarize` and `resultOf`.
- **Ollie tab and build:**
  - `pages/History.tsx` is the tab.
  - `schema.ts` adds `OllieGame`, `OllieHistory`, `OlliePlayers` and the manifest's `ollieFile` and `olliePlayersFile`.
  - `site.tsx` adds `loadOllie` and `loadOlliePlayers` (coach key).
  - `build.mjs` seals `ollie/history.json` (team key) and `coaches/ollie-players.json` (coach key).
  - `validate.ts` checks both files and their library matches.
- **Game template:**
  - `components/GameHeader.tsx` is the shared header, with prev/next and a sticky `.gtabs` bar.
  - `PAGES` is reordered with `report` as the default, and the app bar shows site links only.
  - Each page's hero is replaced by `PageLead` (in `shared.tsx`), and `nav.toc` is sticky under the tabs, with a 104px scroll margin.
- **Routing:** `/` redirects to `/season`, the game list moves to `/library`, and unknown routes go to `/season`. `GameList.tsx` gets icon buttons under the date.
- **Tests:** vitest 56/56, adding `matchInApp`, `seasonOf`, `fmtStat` and `summarize`. `tools/e2e.mjs` lands on the season page, uses the library tab, finds game tabs in `.gtabs`, checks that section links land below the sticky bars, and opens the game history. Build leak check is clean.
- **Rollback:** revert b9ef61f and run `npm run build`. The history files under `private/data/ollie/` can stay; without the code they aren't published.

## 2026-10-20 — Scorekeeper mode, lineups and season overview (f0146ce..f0146ce)

- **New scorekeeper app** at `#/keep`:
  - `app/src/pages/Keep.tsx` (setup wizard, live screen, flows)
  - `components/KeepPitch.tsx` (pitch, drag/tap/long-press)
  - `components/KeepPickers.tsx` (shot spot, goal mouth, line picker, formation thumbnails)
  - `components/VoiceBox.tsx` (dictation box and hold-to-talk fallback)
  - `keeper.tsx` (keys, roster, local log, Supabase sync, delete queue)
  - `supabase.ts` (shared client, now also used by `notes.tsx`)
- **Engine** `lib/keeplog.ts`: append-only log replay, ball/possession state, `tapEvent`, formations (`SHAPES`), stats including possession by clock time, position-only descriptions, and the `toRaw` export with a shot map. `lib/voice.ts` parses dictated lines into commands and runs them against the log. `lib/keeperCrypto.ts` derives the scorekeeper keys.
- **Schema** (`schema.ts`): `KeeperRoster`, `KeepSetup` (formation, side, stop clock, level), `KeepEntry` (setup, clock, end, ev, sub, move, void). The ev entry carries `to`, `cross`, `via`, `result`, `goal`, `assist` and `og`. `EVENT_TYPES` gains Cross, Clearance, Handball, Illegal throw-in, Goal kick, Penalty and Offside, with Spanish labels and play-by-play filters.
- **Build** (`tools/build.mjs`): with `private/.keeper-password`, seals the scorekeeper squad list under a key-derived name. New `tools/keeper-kdf.json` holds the KDF salt (not secret).
- **Database** (`tools/keeper/setup.sql`): `keeper_log` and `keeper_key` tables, closed to the API, reached only through key-checked functions: `keeper_check`, `keeper_append` (idempotent by id), `keeper_list`, `keeper_set_key`, `keeper_delete_test` and `keeper_forget`. `tools/keeper/keeper.ts` provides `setup-sql`, `check`, `games`, `pull <slug> [--as] [--force]`, `forget <slug>` and `rotate`.
- **Also in this push:** roster and lineups (`lib/lineup.ts`, `squad.tsx`, `components/LineupPitch.tsx`, `pages/Players.tsx`), season overview (`lib/season.ts`, `pages/Season.tsx`), name tooltips (`lib/naming.ts`), and validator checks for the roster and lineups.
- **Tests:** vitest 53/53, covering log replay, possession taps, restarts, formations, exports, scorekeeper crypto and voice parsing and running. `tools/e2e.mjs` now covers the full scorekeeper flow on a 844×390 landscape viewport with Supabase blocked: wizard, kickoff, passes, opponent passes, My Team, a shot with assist, out with taker and type, a foul, a wide shot to a goal kick, the lineup sheet swap and sub, voice lines, reload and delete. Build leak check is clean.
- **Rollback:** revert f0146ce and run `npm run build`. The Supabase `keeper_*` objects can stay; they hold only ciphertext.

## 2026-10-19 — 18 October game (e65afa1..e65afa1)

- New private game file (slug `2026-10-18-brsc-black`, distinct from `2026-10-11-brsc`), 32 events, 8 clips, plus a goal-kick/GK-possession table in the match report.
- `public/`: one modified and two new `.bin` (manifest, game data, coaches' breakdown). R2: 8 clips uploaded.
- Validation passes for all 10 games, build passes (63 clips), e2e passes (coach lock, clip decrypted, EN/ES pages). Leak check: only the pre-existing `tools/legacy/acronyms.mjs` regex mentions the club acronym (untouched).
- Rollback: revert e65afa1, remove the private game file, run `npm run build` (prunes the game's clips from R2).

## 2026-10-18 — 17 October game (3799946..a486f74)

- New private game file (slug `2026-10-17-la-fire`), 16 events, 6 clips, sourced from a Hudl HLS broadcast (1080p, ffmpeg). 3799946 adds it; a486f74 corrects team identification (DFC light blue) using kick-off line-ups and rewrites the affected event, report and unit-review text (EN/ES). No clips re-cut.
- `public/`: one modified and two new `.bin` (manifest, game data, coaches' breakdown). R2: 6 clips uploaded.
- Validation passes for all 9 games, build passes, e2e passes (coach lock, clip decrypted, EN/ES pages); leak check clean.
- Rollback: revert a486f74 and 3799946, remove the private game file, run `npm run build` (prunes the game's clips from R2).

## 2026-10-17 — 29 August game (e64014b..9030af4)

- New private game file (slug `2026-08-29-covington`), 12 events, 6 clips; e64014b adds it, 9030af4 replaces the unconfirmed-scorer and 61'-vs-60'+2' flags with coach confirmations (video-time column for the last goal stays 61').
- `public/`: one modified and two new `.bin` (manifest, game data, coaches' breakdown). R2: 6 clips uploaded; nothing re-uploaded on the revise.
- Validation passes for all 8 games, build passes (49 clips in R2), e2e passes (coach lock, clip decrypted, EN/ES pages); leak check clean.
- Rollback: revert 9030af4 and e64014b, remove the private game file, run `npm run build` (prunes the game's clips from R2).

## 2026-10-15 — 27 September game (295e60b..3ccee42)

- New private game file (slug `2026-09-27-gcufc`), 6 clips; 295e60b adds it, 3ccee42 applies coach corrections (ST 8', CB 20' penalty, cards CM 40' / RM 47' / CM 56'), renaming clip `04-goal-20-free-kick` to `04-cb-20-penalty`.
- `public/`: one modified and two new `.bin` (manifest, game data, coaches' breakdown). R2: 6 clips uploaded; the rename re-uploaded 1 and pruned 1.
- Validation passes for all 7 games, build encrypts 7 games / 43 clips, e2e passes (coach lock, clip decrypted, EN/ES pages); leak check clean.
- Rollback: revert 3ccee42 and 295e60b, remove the private game file, run `npm run build` (prunes the game's clips from R2).

## 2026-10-15 — Second 26 September game (786eec1..786eec1)

- New private game file (slug `2026-09-26-hfc`), 30 events, 7 clips; scorer positions and the booked CM set from coach confirmation, clip ids renamed to match (`02-st-15`, `03-lm-29-counter`).
- `public/`: one modified and two new `.bin` (manifest, game data, coaches' breakdown). R2: 7 clips uploaded on the first build; the rename re-uploaded 2 and pruned 2.
- Validation passes for all 6 games, vitest 20/20, e2e passes (6 games, coach lock, clip decrypted from R2, EN/ES pages).
- Rollback: revert 786eec1 and run `npm run build` (prunes the game's clips from R2) after removing the private game file.

## 2026-10-15 — Clips moved to Cloudflare R2 (fe1cc7d..fe1cc7d)

- `tools/lib/r2.mjs` (`@aws-sdk/client-s3` 3.700.0): `loadR2` reads `private/.r2.json` (`//` comment lines allowed; errors never echo contents; rejects the placeholder URL). The client provides `list` (only `^[0-9a-f]{20}\.bin$` keys), `put` (skips when size and MD5 ETag match; `Cache-Control: no-cache` because names survive re-cuts) and `prune`.
- `tools/build.mjs`: R2 settings and the bucket listing are checked before `public/` is cleared. Clips are sealed exactly as before (`games/<slug>/clips/<id>.mp4` path); manifest `clips[*].file` is now the absolute R2 URL. Without `.r2.json` the build falls back to `public/`.
- Bucket CORS: GET/HEAD from the Pages origin and local preview/dev/test origins. Verified: those origins get `Access-Control-Allow-Origin`, others don't.
- First upload: 30 clips; `public/` went from 445 MB to 1 MB. e2e passes, with the clip decrypted from R2.
- Rollback: delete `private/.r2.json`, `npm run build`, push (clips return to `public/`).

## 2026-10-15 — 26 September game and two re-cut clips (ab4602d..5221670)

- New game `private/data/games/2026-09-26-gcufc.json` (18 events from the video, 7 clips, 38 MB). Scorer positions applied from the coach: ST 5'/16', RM pen 29', LM 33', ST 37', RCB 40'/46'. Clip ids renamed to match.
- `2026-10-11-brsc` clips re-timed: `01-cut-back-chance` 11:04–11:49 → 11:44–12:02, `03-rm-break-corner` 29:40–31:35 → 28:30–29:28. Only those clips were re-cut.
- 5221670: the stats attribution for this game was briefly changed to Reeplayer and has been restored to Ollie (consistent with b1394ad). Reeplayer remains for the camera only.
- Build: 5 games, 30 clips, `public/` 445 MB. e2e passes.
- Rollback: `git revert 5221670 ab4602d`, `npm run build`, push.

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
