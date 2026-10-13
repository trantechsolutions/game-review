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
  notes-setup.sql          generated database setup (tools/notes/coach.ts setup-sql)
  data/site.json           team name
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
tools/kdf.json             key-derivation salt and iterations (not secret)
```

## Adding a game

1. Write `private/data/games/YYYY-MM-DD-opponent.json`, in English and Spanish, including the unit reviews. Copy an existing game as the template. People are named by position only, never by name or shirt number.
2. Set `highlights.source` to the full-game video and list the clips, then run `python tools/make_highlights.py --game YYYY-MM-DD-opponent` (add `--cpu` without an NVIDIA GPU).
3. Run `npm run build`, then `node tools/e2e.mjs`.
4. Commit `public/` and push. Unchanged files encrypt to identical bytes, so a push only uploads what changed.

`npm run validate` checks game files on their own. For a big translation, `node tools/i18n.mjs export <slug>` writes the English strings to translate, and `import` writes the Spanish back.

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

## Changing the team password

Write the new password to `private/.site-password`, then run `npm run build`, commit and push. Everyone is signed out.

## Limits

GitHub Pages allows 1 GB per site, which is about 9 games at around 100 MB of highlights each. Git rejects single files over 100 MB, and `make_highlights.py` refuses clips over 95 MB.

## Preview locally

```sh
npm install
npm run build
npm run preview
```
Then open http://localhost:8000. The page must be on `localhost` or `https` for the browser to allow decryption.
