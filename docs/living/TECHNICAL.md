# DFC Game Film: Technical Log

Engineering record per push, newest first.

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
