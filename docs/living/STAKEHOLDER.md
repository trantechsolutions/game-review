# DFC Game Film: What's New

Plain-language notes on what changed on the team's game review site, newest first.

## 2026-10-12 — Unit review page (6c36dbb..6c36dbb)

- Every game has a new **Unit review** page, in English and Spanish. It looks at the defence, the midfield and the attack separately: what went well, what went wrong, and how to improve, such as marking, reading the play, body shape and formation.
- Each point links to the moment in the game it comes from, so it's easy to find on the video. Coaches can leave notes on each unit.

## 2026-10-12 — React app, Spanish and coach notes (029f974..cc76569)

- The site has been rebuilt. It looks the same, but every page now has an English/Español button, and all four games are fully translated into Spanish.
- Coaches have a new coach area, opened with a separate coach password. Coaches can leave notes on a whole game, a section of a report, a highlight clip or a single moment in the play-by-play. Players and parents using the team password don't see notes.
- The section shortcuts at the top of the match report and coaches' breakdown now jump to the right section.
- The password box ignores stray spaces and has a "Show password" option.

## 2026-10-12 — Players identified by position only (796bcdb..796bcdb)

- Players are no longer named or identified by shirt number anywhere on the site. Every game now refers to them by position, for example "the striker" or "the left midfielder", for both DFC and opponents.

## 2026-10-11 — Game 3 film added: DFC 2–1 BRSC (6d4893d..6d4893d)

- Game 3 of the OLOL United Cup (Sunday 11 Oct, home vs BRSC) is now on the site. DFC won 2–1 with two goals from Maxx F.
- It has a play-by-play, a coaches' breakdown, a match report and six highlight clips: both goals, the BRSC goal, a cut-back chance, a break that ended in a header, and a late save.

## 2026-10-11 — Consistent layout after refresh and clip load (37396dd..37396dd)

- The pages now look the same every time: right after you sign in, after a refresh, and after you press Load on a highlight. Nothing jumps around any more.
- The Highlights button shows its play icon correctly.

## 2026-10-11 — Publish encrypted site with opaque names (c3fbaab..c3fbaab)

- The game film site is back online behind the team password, with all three games, highlights and reports.
- Even the names of the files on GitHub are now scrambled, so nobody can tell which games or players are on the site without the password.

## 2026-10-11 — Switch to local encryption, public repo (f235f62..f235f62)

- Nothing changes for viewers. The site still asks for the same team password.
- The site now gets ready on the coach's computer, and only the locked (encrypted) version is ever uploaded. That keeps the videos and reports private even though the project's storage on GitHub is public.

## 2026-10-11 — Game film site launched (initial)

- All three games reviewed so far now live in one place: Krewe (3 Oct), HFC (10 Oct) and CSC Eagles (10 Oct).
- Each game has a play-by-play, a coaches' breakdown, a match report and a new highlights page.
- Highlights are short video clips of the goals, big saves and moments the coaches want to talk about. They play right in the browser.
- The site asks for a team password. Without it, nothing on the site can be read or watched.
- You can tick "Keep me signed in" on your own phone or computer so you don't have to type the password every time.
