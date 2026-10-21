# Game Film

A password-protected game review app, published with GitHub Pages. The app's code is public, but it holds no game content. Every game, clip and the game list are encrypted. Without the team password, nothing here is readable.

Each game has five pages (play-by-play, match report, coaches' breakdown, unit review, highlights), in English and Spanish. The unit review covers the defensive, midfield and attacking units: positives, negatives, and how to improve (marking, reading the play, body shape, formation and more). Coaches unlock a coach area with a separate coach password. It opens the coaches' breakdown, which the team password can't, and lets coaches leave notes on a game, a section, a clip or a single moment.

## How it works

- Each game is one JSON file in `private/data/games/` (its shape is `app/src/schema.ts`). The React app renders all five pages from it, so a new game needs no new pages.
- `private/` stays on the coach's PC. It is ignored by git and never pushed.
- `npm run build` checks every game file, builds the app, then encrypts the games, the game list and the clips into `public/` with AES-256-GCM. The key comes from the team password via PBKDF2-SHA256 with 600,000 iterations. Every encrypted file gets an opaque name, and the build fails if a team, opponent or game name shows up in the readable app files.
- Only `public/` and the source are committed. On push to `main`, GitHub Actions checks that `public/` holds only the app shell and encrypted files, then publishes it.
- In the browser, the password derives the key, which finds and decrypts the game list, then each game and each clip as it's opened.
- The coaches' breakdown is a separate file per game, encrypted with a key derived from the coach password (`private/.coach-password`, read by the build). The team password can't open it, and the app only shows it once the coach area is unlocked.

Anyone can download `public/` and guess passwords offline, so use a long passphrase (four or more random words).

## Layout

```
app/                       the React app (Vite, TypeScript)
  src/schema.ts            the game file format
  src/i18n.tsx             English and Spanish interface text
  src/config.ts            Supabase project and coach-notes settings (public)
private/                   (not in git)
  .site-password           the team password, on one line
  .coach-password          the coach password (coach area: notes and the coaches' breakdown), on one line
  .keeper-password         the scorekeeper password (scorekeeper mode), on one line
  notes-setup.sql          generated database setup (tools/notes/coach.ts setup-sql)
  data/site.json           team name
  data/roster.json         the squad and the positions each player plays (coach password only)
  data/lineups.json        who started where and every change, per game (coach password only)
  data/games/<slug>.json   one file per game, English and Spanish
  data/i18n/               translation work files (tools/i18n.mjs)
  clips/<slug>/<id>.mp4    highlight clips (tools/make_highlights.py)
  legacy/                  the original HTML pages, kept for reference
public/                    built, encrypted output; committed and published
tools/build.mjs            encrypts private data into public/ next to the built app
tools/validate.ts          checks game files (schema, Spanish, references, clips)
tools/i18n.mjs             exports English strings for translation and imports Spanish
tools/make_highlights.py   cuts highlight clips from a full-game video
tools/e2e.mjs              browser test of a local build in both languages
tools/notes/               coach-notes database setup and admin
tools/keeper/              scorekeeper stat-log database setup, admin and import (keeper.ts pull)
tools/ollie/pull.ts        pulls the Ollie Sports game history (sign in through the saved Ollie web app)
tools/manager/manager.ts   NOLA DFC Manager: shared Supabase setup, migration, key link, roster pull
tools/kdf.json             key-derivation salt and iterations (not secret)
```

## Adding a game

1. Write `private/data/games/YYYY-MM-DD-opponent.json`, in English and Spanish, including the unit reviews. Copy an existing game as the template. People are named by position only, never by name or shirt number. Every fix in the coaches' breakdown takes an `area` (the same list as the unit-review improvements); the season overview ranks recurring themes by it.
2. Set `highlights.source` to the full-game video and list the clips, then run `python tools/make_highlights.py --game YYYY-MM-DD-opponent` (add `--cpu` without an NVIDIA GPU).
3. Run `npm run build`, then `node tools/e2e.mjs`.
4. Commit `public/` and push. Unchanged files encrypt to identical bytes, so a push only uploads what changed.

`npm run validate` checks game files on their own. For a big translation, `node tools/i18n.mjs export <slug>` writes the English strings to translate, and `import` writes the Spanish back.

## Roster

`private/data/roster.json` lists the squad for the coaches' breakdown. Positions use the same acronyms as the write-ups, first choice first; `number` is optional.

```json
{
  "players": [
    { "name": "Alex Smith", "number": 4, "positions": ["RCB", "RB"] },
    { "name": "Sam Lee", "positions": ["ST", "LM"] }
  ]
}
```

The build seals it with the coach password, like the breakdown, so the team password can't open it. With players listed, the breakdown gets a Roster section, and every position in it (on hover or tap) also names who could have made the play: players at that spot first-choice first, with general spots matching their sided ones (CB covers LCB and RCB, an LCB-listed player could be "the CB", LM and LW are interchangeable). Game write-ups still name positions only; names live only in this file.

## Lineups

`private/data/lineups.json` records who played where in each game, by roster name. List the starters, then every change in time order: a substitution (`off`, `on`, and `pos` if the player coming on takes a different spot) or a position change (`player`, `pos`). Times are the half and clock, like the play-by-play. A game with no starters has no lineup yet.

```json
{
  "games": {
    "2026-10-18-brsc-black": {
      "start": [{ "pos": "GK", "player": "Braxx Picado" }, { "pos": "ST", "player": "Adam Aly" }],
      "changes": [
        { "h": 2, "c": "0:00", "off": "Adam Aly", "on": "Maxx Fejka" },
        { "h": 2, "c": "12:00", "player": "Maxx Fejka", "pos": "LM" }
      ]
    }
  }
}
```

The build seals it with the coach password and `npm run validate` replays each game: unknown names, a sub for someone not on the field, or a change after the half ends fail the check. With lineups, the coaches' breakdown gets a Lineup section and its position tooltips name who actually played there. The coach area also gets a Players page with season minutes and starts, and a page per player with their positions and the logged moments that name their position while they were on.

## Coach notes

The coach area unlocks with the coach password; there are no accounts or sign-ups. Notes are stored in Supabase, but only as ciphertext:
- The browser turns the coach password into two keys. One encrypts each note before it's sent. The other is the access key sent with every notes request.
- The database keeps only a fingerprint (SHA-256) of the access key. Its notes functions refuse any request without the right key, and the tables can't be reached directly.
- Each note is labelled with an opaque per-game id, so Supabase never sees a note's text, which game it's on, or the coach password.

Setup (once):

1. Put the coach password on one line in `private/.coach-password`. Use 12 or more characters; the notes are only as safe as this password.
2. Run `npx tsx tools/notes/coach.ts setup-sql`. It writes `private/notes-setup.sql`.
3. In Supabase, open SQL Editor, paste that file and run it.
4. Run `npx tsx tools/notes/coach.ts check`. It saves, reads and deletes a test note, and confirms a wrong key is refused.

To change the coach password, put the new one in `private/.coach-password.new` and run `npx tsx tools/notes/coach.ts rotate`. It re-encrypts every note and switches the database to the new key. Then run `npm run build`, commit and push, so the coaches' breakdown is re-encrypted too. Coaches then unlock with the new password.

The free Supabase plan pauses a project after about a week with no activity. Unpause it from the Supabase dashboard; nothing is lost.

## Scorekeeper

`#/keep` (the **Scorekeeper** button on the sign-in page) is a live stat-keeping screen for whoever keeps the book at the game. It opens with its own password, not the team or coach one, and that password opens nothing else: no game film, notes, breakdowns or lineups.

- **Landscape only.** Held upright, the phone asks to be turned. The *Full screen* button also locks the rotation where the phone allows it.
- **Setup, one question at a time:**
  1. Opponent, date, kickoff time, home or away.
  2. Format (1v1 to 11v11).
  3. Beginner (team stats only, no lineup) or advanced (team and individual stats).
  4. Minutes per half (20 to 45, or any length; 30 unless changed), and stop-clock mode if wanted.
  5. Which side our goal is on.
  6. A formation for the format.
  7. The starters. Tap two players to swap them, tap a bench player then a spot, or use *Fill from squad* or *Same as last game*.
- **During the game, it follows the ball:**
  - Tap the player taking the kickoff, then *Start recording*; that starts the clock.
  - Tap whoever gets the ball next. A teammate is a pass, and the player on the ball shows a +N pass-chain count. *Opp. Player* or *Opp. GK* means they won it. Tapping them again is each completed pass of theirs, and tapping one of ours after that means we won it back. *My Team* is a pass when you can't see who got it; the next player tapped carries on from there.
  - Swipe a player to **Shot**, **Cross** or **Clearance**. A shot asks where it was taken, then where it went on a picture of the goal: off target, off the woodwork, blocked by a field player, or on target and then blocked or caught by the keeper, or a goal. A goal by us then asks for the assist, suggesting the last passer.
  - **Out:** tap where the ball crossed the line (it lights up), then *Next*, then who took the restart. The line and the taker decide whether it's a throw-in, corner or goal kick. A corner is then a pass or a cross, and a goal kick a pass or a long kick. Then tap whoever got it first, or mark an *Illegal throw-in*. A shot that misses or is blocked goes straight on to where the ball went out, or *Stayed in play*.
  - **Infractions:** foul, handball, offside, yellow, red or own goal, then who. Fouls and handballs then ask: free kick, penalty or play on.
  - **Clock:** ▶ / ❚❚ pauses and resumes. Past the half's length it holds there and shows the added time beneath, e.g. 35:00 +2:10. Tap the clock to correct it or end a half. Sides switch at half time. In stop-clock mode the clock counts down and stops after goals, cards and subs.
  - **Subs and positions:** ⇅ opens the lineup. Tap two players on the field to swap their positions, one on the field and one on the bench to sub, or the same player twice to give them a new position. Holding a player does the same for that player, and you can also drag a bench player onto the player coming off.
  - *Undo*, or tapping anything in the log, removes it. *Stats* shows the numbers, including possession by time on the ball.
- **Voice:** 🎙 opens a box to dictate into with Wispr Flow (or any keyboard's voice typing). Each line runs once the typing stops, or on Enter. The mic button also works while held, using the phone's own speech recognition.
  - Players are named by number ("9", "number nine"), name (first, last or full; a near miss still finds them) or position in the current lineup ("left back", "striker", "keeper"). The opponent is "them" or "their keeper", and an unknown teammate is "my team".
  - Players in a row are passes, just like taps ("9 to 17 to 4", "them" when they win it). There are also phrases for shots ("17 shot, keeper saves top left", "they shoot wide"), goals ("goal 9 assist Dee", "own goal Ana"), crosses and clearances, restarts ("corner us, crossed", "goal kick them long", "throw in 4"), fouls and cards ("foul on 8", "foul by them, penalty", "yellow Kayden"), subs ("sub Adam for Jayden", "Jayden off, Adam on", "Adam for Jayden and Mario for Dee"), position changes ("Dee moves to striker", "move 6 to left back", "Dee now left back"; plain "Dee to left back" stays a pass), swaps ("swap Dee and Cal"), and "pause", "resume", "half time", "undo".
  - When a restart's team or a foul's offender isn't said, it's the side that didn't have the ball.
  - *Test only* shows what a line would log without logging it. *Heard* keeps every line on the phone, with what it logged or why not, and *Copy* puts that list on the clipboard to send for tuning.
  - Commands are in English.
- **Works with no signal:** every tap is saved on the phone first and sent, encrypted, when there's a connection. The badge shows what is still waiting. A second phone signed in with the same password picks the game up.
- **Deleting a game:** *Delete* in the games list removes it from the phone and from the stat log, so no other phone or `pull` gets it back. Offline, the phone remembers and finishes the delete once it's back online.

The build seals a squad list for the scorekeeper (names, numbers, positions and our short name) with the scorekeeper password. Supabase only ever stores encrypted entries under an opaque per-game id, as with notes.

Setup (once):

1. Put the scorekeeper password on one line in `private/.keeper-password`. Use four or more random words, and make it different from the team and coach passwords.
2. Run `npx tsx tools/keeper/keeper.ts setup-sql`. It writes `private/keeper-setup.sql`.
3. In Supabase, open SQL Editor, paste that file and run it.
4. Run `npx tsx tools/keeper/keeper.ts check`.
5. Run `npm run build`, commit and push. Give the scorekeeper the site address with `#/keep` on the end, plus the password. They sign in once with a connection.

After a game:

- `npx tsx tools/keeper/keeper.ts games` lists the logged games.
- `npx tsx tools/keeper/keeper.ts pull <slug>` writes `private/data/raw/<slug>-live.json`: the score, every moment with its time, position, pitch spot and a description that names positions only (English and Spanish), the stat table (goals, possession, shots, on target, saves, passes, crosses, clearances, ball wins and losses, fouls, offsides, set pieces, cards), a shot map (where each shot was taken and where it went on the goal) and the lineup. Use it in place of Ollie's Final Score when writing the game file.
- Once `private/data/games/<slug>.json` exists, run `pull` again to put the lineup into `lineups.json`. Add `--as <game-slug>` if the game file's slug differs from the scorekeeper's, and `--force` to replace a confirmed lineup.

`npx tsx tools/keeper/keeper.ts forget <slug>` removes a whole game from the stat logs, such as a test or a game started twice.

To change the scorekeeper password, put the new one in `private/.keeper-password.new` and run `npx tsx tools/keeper/keeper.ts rotate`, then rebuild and push.

## Ollie Sports history

The **Game history** tab lists every game kept in Ollie Sports that the library doesn't already break down, newest first. It shows the date, opponent, result, possession, shots and shots on goal, with a season filter and an opponent search. Tapping a game opens Ollie's full team numbers for the whole game and each half. With the coach area unlocked, it also shows each player's minutes, goals, assists, shots, passes and so on. A switch brings back the games the library already has, with a link to each one's breakdown.

To add or refresh it:

1. Run `npx tsx tools/ollie/pull.ts`. Add `--team "13/14B Black"` to pull one team only.
2. It serves the saved Ollie web app from `docs/reference/ollie-web` and opens it in a browser window. Sign in to Ollie there; the profile in `private/.ollie-profile` keeps you signed in for next time.
3. The tool reads, from Ollie's database: the account's teams, each team's finished games, each game's calendar entry (date, opponent), the stat snapshots (whole game and both halves) and the players.
4. It writes `private/data/ollie/history.json` (team stats, plus which library game each one is), `players.json` (player stats) and `raw.json` (Ollie's answers, for checking). Nothing about the sign-in is saved.
5. Run `npm run build`, then commit and push. The history is encrypted with the team password; player stats name players, so they're encrypted with the coach password.

`npm run validate` checks the history against its schema and that every library match points at a real game. Library games are matched by date, then by the same score or a shared opponent word.

## NOLA DFC Manager

This site and [NOLA DFC Manager](https://github.com/trantechsolutions/nola-dfc-manager) work together for the U13 Black team, on the manager's Supabase project:

- **Open from the manager:** a **Game film** card opens this site already unlocked, using whatever the account's place on the team allows. For staff it's on the team overview; in the parent portal it's under the **About** card.
  - Everyone on the team (staff, guardians of active players, scorekeepers) gets the games.
  - Head and assistant coaches, team managers and club admins also get the coach area.
  - The **Scorekeeper** role, assigned in the manager's Team Users like the other roles, adds the scorekeeper screen. It grants nothing else in the manager, so a parent with it keeps the parent portal. A scorekeeper with no player on the team sees the card on their empty "no players" screen.
  - Nobody needs the passwords any more. They still work, and they're still what the keys come from.
- **How the keys travel:** the manager passes them in the part of the link after `#`, which browsers never send to a server. This site stores them as if the password had been typed, then replaces the address (`app/src/lib/unlock.ts`). The keys sit in the manager's `film_sites` table, which only the `film_access()` function can read, and it hands each user only their share (`nola-dfc-manager/sql/game_film_migration.sql`).
- **Roster:** the manager is the source of truth for who is on the team, their names and shirt numbers. Positions stay in `roster.json`. `npx tsx tools/manager/manager.ts roster` updates the roster:
  - it links each player to their manager record;
  - it adds new players, with empty positions to fill in;
  - it renames players in `lineups.json` when the manager's spelling changed;
  - it keeps players the manager no longer lists, because old games still name them.

  `--dry-run` shows the changes without writing.
- **Schedule into the scorekeeper:** `npx tsx tools/manager/manager.ts schedule` writes the team's games from the manager's schedule to `private/data/schedule.json` (date, kickoff, opponent read from the title, venue, and away when the title says "@"). The next build seals it into the scorekeeper's squad file, so a new game is set up by tapping "Today · vs …". The breakdown agent starts new game files from it too.
- **Breakdowns into the manager's schedule:** after `npm run build`, `npx tsx tools/manager/manager.ts games` matches each game file to its game in the manager's schedule (same day and opponent, else the only game that day, else the tournament that weekend) and lists it in the manager's `film_games` table. The manager's schedule then shows **Match report** and **Highlights** on those games, opening this site already unlocked on that page. `--dry-run` shows the matches without writing. It needs `nola-dfc-manager/sql/game_film_games_migration.sql` run once.

- **Season stats into the manager:** `npx tsx tools/manager/manager.ts stats` works out each player's season (the manager's July–June seasons) and writes it to the manager's `player_season_stats`:
  - minutes, starts and positions, from the lineups, else the scorekeeper's lineup, else Ollie's playing time;
  - goals, assists, shots and cards, from the scorekeeper's logs, else Ollie (the breakdowns name positions, not players).

  A game recorded in more than one place counts once, from its best source. The manager shows the numbers on the player profile, beside the season evaluations, and to the player's own parents. `--dry-run` prints them without writing. Needs `nola-dfc-manager/sql/player_season_stats_migration.sql` run once, and `roster` run first so players have their manager ids.
- **Scorekeeping under real accounts:** opened from the manager's **Keep stats**, the scorekeeper screen gets a token for the signed-in account (30 days). Its entries are then sent as that account, recorded with the team and who sent them, and stop going through if the account loses its coach or scorekeeper role ("Open Keep stats from the manager again"). The scorekeeper password still works for a volunteer without an account. Needs `nola-dfc-manager/sql/keeper_accounts_migration.sql` run once.

`private/.manager.json` (never committed):
```json
{
  "url": "https://<manager project>.supabase.co",
  "serviceRoleKey": "…",
  "teamId": "<the U13 Black team's id>",
  "siteUrl": "https://trantechsolutions.github.io/game-review/",
  "timeZone": "America/Chicago"
}
```
`timeZone` is optional (that's the default): it's where the team plays, for schedule dates and kickoffs.
The service_role key (Supabase → Project settings → API) can read and write everything in the manager's database. Keep it in this file only.

Moving to the manager's Supabase project (once):

1. In the manager project's SQL editor, run `nola-dfc-manager/sql/game_film_migration.sql`.
2. Run `npx tsx tools/manager/manager.ts teams` and put U13 Black's id in `teamId`.
3. Run `npx tsx tools/manager/manager.ts setup-sql`, then paste `private/film-setup.sql` (coach notes and scorekeeper stat logs) into the same SQL editor.
4. Run `npx tsx tools/manager/manager.ts migrate`. It copies the coach notes and stat logs from the project `app/src/config.ts` still points at.
5. Switch `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `app/src/config.ts` to the manager project's (Project settings → API; the anon key is public).
6. Run `npx tsx tools/manager/manager.ts link`, then `check`, then `roster`.
7. Run `npm run build`, commit and push both repos.

After changing any of the three passwords, run `link` again, so the manager hands out the new keys.

Each time games are added: `schedule` before `npm run build` (so the scorekeeper has the latest schedule), then `games` and `stats` after it (so the manager's schedule links to the new breakdowns and the player numbers are current).

## Clip storage (Cloudflare R2)

Highlight clips are stored in a Cloudflare R2 bucket rather than in `public/`: R2's free plan has 10 GB of storage and free downloads, against GitHub Pages' 1 GB. They are encrypted exactly as before, so anyone who finds the bucket only gets scrambled bytes under opaque names. The bucket's address is only inside the encrypted game list.

`private/.r2.json` (never committed; lines starting with `//` are comments):
```json
{
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "bucket": "<bucket>",
  "accessKeyId": "…",
  "secretAccessKey": "…",
  "publicUrl": "https://pub-<id>.r2.dev"
}
```
- The bucket needs its Public Development URL enabled and a CORS policy allowing GET and HEAD from the site (`https://trantechsolutions.github.io`) and from the local preview, dev and test addresses.
- The API token needs Object Read & Write on that bucket only.
- `npm run build` uploads new or changed clips, skips ones already in the bucket (same MD5), and removes clips that are no longer published.
- Without `private/.r2.json`, the build falls back to publishing clips in `public/`.

## Changing the team password

Write the new password to `private/.site-password`, then run `npm run build`, commit and push. Everyone is signed out.

## Limits

GitHub Pages allows 1 GB per site; with clips on R2 the site itself is only a few MB. R2's free plan holds 10 GB of clips, roughly 100 games at about 90 MB each. Git rejects single files over 100 MB, and `make_highlights.py` refuses clips over 95 MB.

## Preview locally

```sh
npm install
npm run build
npm run preview
```
Then open http://localhost:8000. The page must be on `localhost` or `https` for the browser to allow decryption.
