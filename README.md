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
