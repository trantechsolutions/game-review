# DFC Game Film: Management Log

Scope, decisions, risk and open items for each release, newest first.

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
