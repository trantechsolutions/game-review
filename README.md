# Game Film

A password-protected game review site, published with GitHub Pages. Every page and clip in this repository is encrypted. Without the team password, nothing here is readable.

## How it works

- The readable report pages, highlight clips and password stay on the coach's PC in `private/`. That folder is ignored by git and never pushed.
- `node tools/build.mjs` encrypts `private/site/` into `public/` with AES-256-GCM. The key comes from the password via PBKDF2-SHA256 with 600,000 iterations.
- Only `public/` is committed. On push, GitHub Actions publishes it as-is, after checking that every page in it is encrypted.
- In the browser, the password screen derives the key and decrypts each page, and each clip when someone presses Load.

Anyone can download `public/` and guess passwords offline, so use a long passphrase (four or more random words).

## Layout

```
private/                  (not in git) readable source
  .site-password          the password, on one line
  highlights.json         which moments to cut, per game
  site/index.html         game list (GAMES array)
  site/games/<date>-<opponent>/{play-by-play,coaches-breakdown,match-report,highlights}.html, clips/*.mp4
public/                   encrypted output; committed and published
tools/build.mjs           encrypts private/site into public/
tools/make_highlights.py  cuts highlight clips from a full-game video
tools/kdf.json            key-derivation salt and iterations (not secret)
tools/assets/             password screen and in-browser decryption
```

## Adding a game

1. Copy the game's three report pages into `private/site/games/YYYY-MM-DD-opponent/` as `play-by-play.html`, `coaches-breakdown.html` and `match-report.html`.
2. Add the game's key moments to `private/highlights.json`, then run `python tools/make_highlights.py --game YYYY-MM-DD-opponent` (add `--cpu` without an NVIDIA GPU).
3. Add the game to the top of `GAMES` in `private/site/index.html`.
4. Run `node tools/build.mjs`, then commit `public/` and push. Unchanged files encrypt to identical bytes, so a push only uploads what changed.

## Changing the password

Write the new password to `private/.site-password`, then run `node tools/build.mjs`, commit and push. Everyone is signed out.

## Limits

GitHub Pages allows 1 GB per site, which is about 9 games at around 100 MB of highlights each. Git rejects single files over 100 MB, and `make_highlights.py` refuses clips over 95 MB.

## Preview locally

```sh
node tools/build.mjs
python -m http.server 8000 -d public
```
Then open http://localhost:8000. The page must be on `localhost` or `https` for the browser to allow decryption.
