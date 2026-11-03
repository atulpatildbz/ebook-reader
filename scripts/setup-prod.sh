#!/usr/bin/env bash
# One-time production setup: Convex prod deployment + GitHub repo + GitHub Pages.
# Run from the repo root: scripts/setup-prod.sh
# Safe to re-run: each step either repeats harmlessly or is skipped.
set -euo pipefail

REPO=atulpatildbz/ebook-reader
SITE=https://atulpatildbz.github.io/ebook-reader
OWNER_EMAIL=atulpatildbz@gmail.com

echo "1/6  Deploying convex/ to the production deployment"
out=$(npx convex deploy -y 2>&1) || { echo "$out"; exit 1; }
CONVEX_URL=$(grep -oE 'https://[a-z0-9-]+\.convex\.cloud' <<<"$out" | head -1)
[ -n "$CONVEX_URL" ] || { echo "$out"; echo "Could not find the prod URL above"; exit 1; }
echo "     $CONVEX_URL"

echo "2/6  Production environment: session keys, site URL, Google client (from Habitool)"
node scripts/convex-keys.mjs --prod
npx convex env set --prod SITE_URL "$SITE"
for k in AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do
  npx convex env set --prod "$k" -- "$(cd ../Habitool && npx convex env get "$k")"
done

echo "3/6  Allowlisting $OWNER_EMAIL"
npx convex run --prod allowlist:grant "{\"email\":\"$OWNER_EMAIL\"}"

echo "4/6  GitHub repository (public: free GitHub Pages needs it; it holds code only)"
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public \
    --description "Ribbon: a personal cross-device ebook reader (EPUB, MOBI, AZW3, PDF) with progress synced through Convex"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "git@github.com:$REPO.git"

echo "5/6  Pages from GitHub Actions, pointed at the prod backend"
gh variable set CONVEX_URL --repo "$REPO" --body "$CONVEX_URL"
gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null

echo "6/6  Pushing main (starts the Pages build)"
git push -u origin main

echo
echo "Done. One manual step left: add this redirect URI to the Habitool OAuth client:"
echo "  ${CONVEX_URL%.convex.cloud}.convex.site/api/auth/callback/google"
echo "Site (live in a minute or two): $SITE/"
