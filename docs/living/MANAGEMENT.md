# DFC Game Film: Management Log

Scope, decisions, risk and open items for each release, newest first.

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
