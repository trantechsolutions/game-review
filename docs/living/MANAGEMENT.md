# DFC Game Film: Management Log

Scope, decisions, risk and open items for each release, newest first.

## 2026-10-15 — Clips moved to Cloudflare R2 (fe1cc7d..fe1cc7d)

**Delivered.** Highlight clips moved from GitHub Pages (1 GB limit, about 445 MB used) to a Cloudflare R2 bucket on the free plan (10 GB storage, free downloads). The published site is now about 1 MB. Capacity goes from roughly 10 games to roughly 100.

**Decisions.** Clips keep the same encryption and opaque names, so the bucket only holds unreadable data. The bucket's address is stored only inside the encrypted game list. Access is restricted by a CORS policy, and the upload key only has read/write access to this one bucket.

**Risk.** The public r2.dev address is rate-limited by Cloudflare; if clips ever load slowly, connect a custom domain to the bucket. An API token was briefly exposed in a tool's error output during setup and was rolled immediately. Clips already committed remain in the repository history unless it is rewritten.

## 2026-10-15 — 26 September game and two re-cut clips (ab4602d..5221670)

**Delivered.** Fifth game added (the first broken down without an events log; every event was timed from the video). Scorer positions were confirmed by the coach. Two mistimed BRSC clips were re-cut after a frame-by-frame review.

**Open.** Two goal minutes differ between Ollie and the video (36'/37' vs 37'/40'); the site uses the video and notes the difference. Four non-goal clips across the season remain unconfirmed because the camera is too far to show the moment. The site is at about 445 MB of the 1 GB Pages limit; moving clips to Cloudflare R2 is next.

## 2026-10-15 — Breakdowns from a video link, stats credited to Ollie (6e3ecee..b1394ad)

**Delivered.** A game can now be analysed from two inputs: the Reeplayer video link and the Ollie stats screen (or export). New tools download the full video and find likely moments from the referee's whistle and crowd noise. The analyst then confirms each moment on still frames and checks the shot totals against Ollie. Two games' pages had credited the stats to Reeplayer; they now credit Ollie.

**Decision.** Without an events log, Ollie's goal and card minutes are the fixed reference points, and the shot count must reconcile with Ollie's totals. Shots the video can't place are reported, never invented. The tools run on the coach's PC; the full video never enters the repository.

**Risk.** A breakdown built from the video alone will have thinner build-up detail than one built from a hand-written log. The sound cues miss some moments (on the test game: the first goal's crowd noise, and the early red card), so the frame sweep is still needed. The link lookup depends on Reeplayer's share page layout, which could change without notice.

**Effort.** About one day: link resolver, cue finder, contact sheets, working-file cutter, and the agent update. It was tuned against an already-analysed game.

**Open.** A first full breakdown on a new game using only the link and Ollie. A tracked legacy script (`tools/legacy/acronyms.mjs`, from 55fa811) still contains opponent short names in plain text and should be scrubbed.

## 2026-10-12 — Coaches-only breakdown and a re-cut save clip (f3d2a85..f3d2a85)

**Delivered.** The coaches' breakdown is encrypted with a key from the coach password, separate from the team password, and hidden in the app until the coach area is unlocked. A review of the non-goal highlight clips found the Krewe fast-break save clip mistimed; it was re-cut and checked against the full video.

**Risk.** Older copies of the breakdown remain in the repository's history, encrypted with the team password; removing them would need a history rewrite (not done). Changing the coach password now also needs a site rebuild. Clip review: the Krewe one-on-one and HFC ball-win clips look mistimed but couldn't be confirmed at the camera's distance. Four other non-goal clips are not yet reviewed.

**Open.** Times for the uncertain clips (ideally from the coaching staff scrubbing the full video), and a decision on the history rewrite.

## 2026-10-12 — Positions as acronyms (55fa811..55fa811)

**Delivered.** All four games now use position acronyms throughout (385 passages updated, both languages), with the full name shown on hover or tap. Future breakdowns must follow the same convention: the build rejects spelled-out positions.

**Decision.** Unit headings, pitch areas and group words ("the defenders") stay as words. A player whose side wasn't recorded is a general acronym (WM, FB, CB) rather than a guessed side.

**Risk.** Low. Wording only; no change to security, hosting or site size.

## 2026-10-12 — Unit review page (6c36dbb..6c36dbb)

**Delivered.** A fifth page per game: a review of the defensive, midfield and attacking units with positives, negatives and tagged improvements. Written for all four games in both languages. The analyst agent now produces it for every new game.

**Decision.** Every point must cite a logged moment, and the build rejects a review that cites a moment not in the game's log. This keeps the reviews grounded in the tape rather than generic advice.

**Risk.** Low. Content only; no change to security or hosting. Site size unchanged (about 421 MB of the 1 GB limit).

## 2026-10-12 — React app, Spanish and coach notes (029f974..cc76569)

**Delivered.** The site is now a React app. Each game is one data file rendered by shared page templates, so adding a game no longer means building four pages by hand. All four games were converted and translated into Spanish. Coaches have an encrypted notes area backed by Supabase (free plan).

**Decisions.**
- *Spanish written at breakdown time*, not machine-translated in the browser: reviewed text, no third-party service sees the content, no running cost.
- *Coach area unlocks with a coach password only, no accounts.* The password derives an encryption key and an access key. Supabase stores only ciphertext and a fingerprint of the access key, so it never sees note text, which game a note is on, or the password.
- *Same privacy model as before.* Games, clips and the game list stay encrypted with the team password, and the public app code no longer contains the team or opponent names. The deploy workflow rejects anything unencrypted.

**Risk.** Low for viewers: same password, same look, verified by an automated browser test in both languages. Notes are only as strong as the coach password, so it should be 12+ characters. The free Supabase project pauses after about a week idle and must be unpaused from the dashboard; no data is lost.

**Open.** An earlier stakeholder entry (2026-10-11, game 3) still names a player in plain text. Changing the coach password later uses the rotate tool, which re-encrypts every note.

## 2026-10-12 — Players identified by position only (796bcdb..796bcdb)

**Delivered.** Player names and jersey numbers were removed from all four games (reports, highlights, clip titles and clip file names) and replaced with positions. The decision covers both teams and coaching staff; none of the pages named coaches.

**Judgement calls.** Where a page did not say which position someone played, the nearest fit was used (for example "the wide midfielder" or "a DFC midfielder"). These should be checked by the coaching staff.

**Open.** A player's name still appears in plain text in an earlier entry of the stakeholder log (2026-10-11, game 3) and therefore in the public repository history. Fixing it means editing that entry and, for full removal, rewriting history. Awaiting a decision.

## 2026-10-11 — Game 3 film added: DFC 2–1 BRSC (6d4893d..6d4893d)

**Delivered.** Fourth game on the site, with all three reports and six highlights (about 104 MB). The breakdown was checked against the video: kickoffs, all three goals and the corrected card calls match. One wording fix in the coaches' breakdown: a header that went wide had been counted as a keeper save.

**Open.** There was no Reeplayer Final Score screenshot, so possession (72%), shot counts, the scorer's name and the 6' red card are unverified. The late-save clip is placed only to within about 3 minutes and may miss the save.

**Capacity.** The published site is now 402 MB of the 1 GB Pages limit, which leaves room for about five more games at this size.

## 2026-10-11 — Consistent layout after refresh and clip load (37396dd..37396dd)

**Delivered.** Fixed a layout bug users saw on refresh and when loading highlight clips. This was a small, contained change to the unlock script, with no change to content or security.

**Risk.** Low. Verified in Chrome by scripting login, refresh, navigation and clip load.

## 2026-10-11 — Publish encrypted site with opaque names (c3fbaab..c3fbaab)

**Delivered.** The site is live again from the public repository on the free plan. Every page and clip is encrypted on the coach's PC, and file names no longer reveal games, opponents or players.

**Decision.** Opaque file names were added after a review showed that clip names (for example a scorer's first name and minute) would have been public even though the contents were encrypted.

**Risk.** Unchanged from the previous entry: password strength, the replaced commit reachable by exact ID until purged, and source files that exist only on the coach's PC.

## 2026-10-11 — Switch to local encryption, public repo (f235f62..f235f62)

**Why.** The repository is public on the free GitHub plan, and Pages cannot publish from a private repository without a paid plan. The first setup (2026-10-11, initial) committed readable pages and clips, so they were publicly visible for a short time.

**Decision.** Encrypt on the coach's PC and commit only encrypted output. The password now lives in a local file on that PC instead of a GitHub secret. The repository history was replaced so the readable commit is no longer on any branch.

**Risk.** GitHub can still serve the replaced commit to anyone who has its exact ID until it is purged. Full removal needs the repository deleted and recreated, or a GitHub Support request. If the PC is lost, the source pages and clips must be rebuilt from the original game folders.

**Open.** Decide whether to delete and recreate the repo to purge the old commit. The `SITE_PASSWORD` Actions secret is no longer used and can be deleted.

## 2026-10-11 — Game film site launched (initial)

**Delivered.** One password-protected site for the three games reviewed to date. Each has a play-by-play, coaches' breakdown, match report and 5–7 highlight clips (17 clips, about 300 MB in total).

**Decisions.**
- *Highlights, not full clips.* The full 5-minute working clips total 15.2 GB, which is 15 times the 1 GB GitHub Pages limit. Highlights average about 100 MB per game. Full recordings stay on the coach's PC and in Reeplayer.
- *Encryption instead of a login.* GitHub Pages cannot require a login. The password is held as a GitHub secret and used at build time to encrypt everything, so the published site is unreadable without it.
- *Private repository.* The source holds player names and unencrypted video, so the repo must be private. Pages from a private repo requires a paid GitHub plan (Pro, about $4 a month).

**Risks.**
- Password strength is the only protection on the published files. Use a long passphrase and change it if it leaks (one secret update and a redeploy).
- Capacity is about 9 games before the 1 GB Pages limit. After that, the options are trimming older highlights, lowering clip quality, or moving video to dedicated storage.

**Open.** Confirm the GitHub plan supports Pages on a private repo. Set the password secret. Review the highlight clip windows on video, since they are timed from the written analyses (accurate to about 30–60 seconds).
