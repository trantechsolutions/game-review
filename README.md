# Game Film

A password-protected game review app, published with GitHub Pages. The app's code is public, but it holds no game content. Every game, clip and the game list are encrypted. Without the team password, nothing here is readable.

Each game has four pages (play-by-play, match report, coaches' breakdown, highlights), in English and Spanish. Coaches can sign in with a separate coach password and leave notes on a game, a section, a clip or a single moment.

## How it works

- Each game is one JSON file in `private/data/games/` (its shape is `app/src/schema.ts`). The React app renders all four pages from it, so a new game needs no new pages.
- `private/` stays on the coach's PC. It is ignored by git and never pushed.
- `npm run build` checks every game file, builds the app, then encrypts the games, the game list and the clips into `public/` with AES-256-GCM. The key comes from the team password via PBKDF2-SHA256 with 600,000 iterations. Every encrypted file gets an opaque name, and the build fails if a team, opponent or game name shows up in the readable app files.
- Only `public/` and the source are committed. On push to `main`, GitHub Actions checks that `public/` holds only the app shell and encrypted files, then publishes it.
- In the browser, the password derives the key, which finds and decrypts the game list, then each game and each clip as it's opened.

Anyone can download `public/` and guess passwords offline, so use a long passphrase (four or more random words).

## Layout

```
app/                       the React app (Vite, TypeScript)
  src/schema.ts            the game file format
  src/i18n.tsx             English and Spanish interface text
  src/config.ts            Supabase project and coach-notes settings (public)
private/                   (not in git)
  .site-password           the team password, on one line
  .coach-password          the coach-notes password, on one line
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

1. Write `private/data/games/YYYY-MM-DD-opponent.json`, in English and Spanish. Copy an existing game as the template. People are named by position only, never by name or shirt number.
2. Set `highlights.source` to the full-game video and list the clips, then run `python tools/make_highlights.py --game YYYY-MM-DD-opponent` (add `--cpu` without an NVIDIA GPU).
3. Run `npm run build`, then `node tools/e2e.mjs`.
4. Commit `public/` and push. Unchanged files encrypt to identical bytes, so a push only uploads what changed.

`npm run validate` checks game files on their own. For a big translation, `node tools/i18n.mjs export <slug>` writes the English strings to translate, and `import` writes the Spanish back.

## Coach notes

Notes are stored in Supabase, but only as ciphertext: the browser encrypts each note with a key derived from the coach password, and labels it with an opaque per-game id. Supabase never sees a note's text, which game it belongs to, or the coach password. All coaches share one Supabase account whose password is derived from the coach password.

Setup (once):

1. Put the coach password on one line in `private/.coach-password`.
2. Run `npx tsx tools/notes/coach.ts auth-password`. It prints the email and the derived Supabase password.
3. In Supabase, go to Authentication → Users → Add user → Create new user. Enter that email and password, and tick Auto Confirm User.
4. In Supabase, go to SQL Editor, paste `tools/notes/setup.sql` and run it.
5. Recommended: under Authentication → Sign In / Providers, turn off "Allow new users to sign up" (and Google, unless it's used). The database only lets the coach account in either way.
6. Run `npx tsx tools/notes/coach.ts check`. It writes, reads and deletes a test note, and confirms nothing is readable signed out.

To change the coach password, put the new one in `private/.coach-password.new` and run `npx tsx tools/notes/coach.ts rotate`. It re-encrypts every note and updates the Supabase password.

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
