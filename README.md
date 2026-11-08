# Ribbon

A personal ebook reader for the web: upload books you own (EPUB, MOBI, AZW3/AZW, PDF, also FB2
and CBZ), read them in any browser, and pick up on one device where you stopped on another.
Sign-in is Google, limited to invited accounts (currently only atulpatildbz@gmail.com).

## How it works

- **Rendering**: [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), vendored as plain
  ES modules in `public/foliate-js/` at the commit in `public/foliate-js/UPSTREAM_COMMIT`. It is
  served as-is, not bundled, because it loads pdf.js, its worker and fonts relative to
  `import.meta.url` (`vite.config.ts` serves it raw in dev too). To update it, copy a newer
  checkout over that folder, minus `tests/`, `reader.*`, `ui/`, `rollup*` and `*.map`.
- **Books**: on upload the browser reads title, author and cover (`src/library/importBook.ts`), hashes
  the file (SHA-256, so the same file is stored once), and puts the file and a small cover JPEG in
  Convex file storage, private to the account. Each browser keeps the books it has opened in
  IndexedDB (`src/lib/bookCache.ts`), so reopening is instant and works offline.
- **Position sync**: the position is an EPUB CFI (for PDFs, the page). Each page turn is saved
  locally at once and pushed to Convex 1.5 s after the page settles, and when the tab is hidden or
  closed. Opening a book starts at the newest of this device's position and the synced one. While
  a book is open, a newer position from another device brings up a prompt (Go there / Stay here)
  rather than moving the page under you. Moves the reader didn't make, like a resize reflowing the
  text, are not saved. A position saved offline is pushed next time.
- **E-reader sync**: e-readers that speak KOReader Sync (CrossPoint on the Xteink, KOReader) sync
  positions through `https://<deployment>.convex.site/kosync` (`convex/http.ts`, `convex/kosync.ts`),
  with a password made in Library → E-reader sync. Books are matched by file name or content hash,
  and positions arrive as KOReader XPointers, turned into CFIs in the browser (`src/reader/xpointer.ts`).
- **Reading settings** (theme, font, size, spacing, width, layout, dim) stay per device in
  `localStorage`: a phone and a laptop want different sizes. There are five day and five night
  themes; "Match system" switches between the chosen pair with the OS. PDFs are pictures of pages,
  so they are tinted (day) or inverted (night) instead of restyled.
- **Access**: [Convex Auth](https://labs.convex.dev/auth) with Google. `beforeSessionCreation` in
  `convex/auth.ts` refuses emails missing from the `allowedEmails` table, and every query and
  mutation checks it again.

Reader keys: ←/→ (or h/l) turn pages, Space/PageDown and Shift+Space/PageUp go forward and back,
Esc closes panels. On touch screens: tap the left or right edge to turn the page, the middle for
the toolbars, or swipe.

## What is deployed where

| Part | Where | Deployed by |
|---|---|---|
| Web app | GitHub Pages | **automatic** on push to `main` (`.github/workflows/pages.yml`) |
| Backend (`convex/`): sign-in, library, positions, files | Convex project `ebook-reader` (team `atulpatildbz`) | **by hand**: `npx convex deploy` |

- Dev deployment: `adamant-fennec-659` (used by `npm run dev`; `.env.local`).
- The Pages build reads the backend URL from the repository variable `CONVEX_URL`
  (`https://<prod-deployment>.convex.cloud`).
- Google sign-in uses the **Habitool** OAuth client in Google Cloud project **"first"**. Its
  *Authorised redirect URIs* must list `https://<deployment>.convex.site/api/auth/callback/google`
  for each deployment.
- Each deployment has its own environment variables and data:

  | Variable | Value |
  |---|---|
  | `SITE_URL` | prod: the Pages URL, e.g. `https://atulpatildbz.github.io/ebook-reader`; dev: `http://localhost:5173` |
  | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | the Habitool OAuth client's ID and secret |
  | `JWT_PRIVATE_KEY`, `JWKS` | session signing keys from `node scripts/convex-keys.mjs [--prod]` |

### Setting up a deployment

`scripts/setup-prod.sh` does all of this for production in one go. By hand:

1. `npx convex deploy` (prod) or `npx convex dev --once` (dev) to create it and push `convex/`.
2. `node scripts/convex-keys.mjs --prod` (omit `--prod` for dev).
3. `npx convex env set --prod SITE_URL https://atulpatildbz.github.io/ebook-reader`
4. Google keys, copied from the Habitool project (prints only "Successfully set"):
   `for k in AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do npx convex env set --prod $k -- "$(cd ../Habitool && npx convex env get $k)"; done`
5. Add the deployment's callback URL (above) to the Habitool OAuth client and save.
6. `npx convex run --prod allowlist:grant '{"email":"atulpatildbz@gmail.com"}'`
   (`allowlist:revoke`, `allowlist:list`; takes effect immediately).
7. Prod only: `gh variable set CONVEX_URL --body https://<deployment>.convex.cloud`, then push.

## Developing

    npm install
    npx convex dev        # keeps convex/ pushed to the dev deployment
    npm run dev           # http://localhost:5173

Without signing in, dev-only pages (left out of production builds) help with the UI: put books in
`dev-books/` (git-ignored) and open `http://localhost:5173/?harness=<file>` for the reader
(`harnessRemote({...})` in the console fakes another device moving ahead), or `?harness=library`
(or `library-empty`) for the library with made-up books. `?harness=narration`, also on the live
site, tries the voices and measures how fast a device makes speech.

`npm run typecheck` checks both the app and `convex/`.

Code layout: `src/library/` (the shelf, adding books, e-reader sync setup), `src/reader/` (the book
open, with its position sync in `position.ts`) and one folder per reader feature (`search/`,
`copy/`, `narration/`); `src/lib/` and `src/ui/` hold what both sides share.

## Not yet

- Kindle (needs a jailbreak): no browser to run this in. (The Xteink has none either, but syncs its
  position over KOReader Sync; see above.)
- Highlights, notes, bookmarks, dictionary: foliate-js supports them; not wired up yet.
- DRM-protected files can't be opened; only DRM-free copies work.
