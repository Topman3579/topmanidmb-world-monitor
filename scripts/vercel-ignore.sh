#!/bin/bash
# Vercel Ignored Build Step: exit 0 = skip, exit 1 = build.
# Automatic Git deployments are only created for `main` (git.deploymentEnabled
# in vercel.json). This script does not turn other branches back on. It runs
# for deployments that actually start: production on main, and manual previews
# such as `vercel deploy`. Skip when no web-relevant paths changed.

# On main: skip if ONLY scripts/, docs/, .github/, or non-web files changed
# since the previous production deployment.
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ] && [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && {
    WEB_CHANGES=$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
      'src/' 'api/' 'server/' 'shared/' 'public/' 'blog-site/' 'pro-test/' 'proto/' 'convex/' \
      'CHANGELOG.md' 'docs/snapshots/' \
      'package.json' 'package-lock.json' 'vite.config.ts' 'tsconfig.json' \
      'tsconfig.api.json' 'vercel.json' 'middleware.ts' 'index.html' | head -1)
    [ -z "$WEB_CHANGES" ] && echo "Skipping: no web-relevant changes on main" && exit 0
  }
  exit 1
fi

# Non-main refs reach here only when a deployment was started outside
# automatic Git (for example `vercel deploy`). Compare against merge-base
# with origin/main — everything on this ref since it left main — and fall
# back to VERCEL_GIT_PREVIOUS_SHA when origin/main is missing from the clone.
# Do not gate on VERCEL_GIT_PULL_REQUEST_ID; Vercel leaves it empty on some
# deploy paths, including dashboard redeploys.
COMPARE_SHA=$(git merge-base HEAD origin/main 2>/dev/null)
if [ -z "$COMPARE_SHA" ] && [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && COMPARE_SHA="$VERCEL_GIT_PREVIOUS_SHA"
fi
[ -z "$COMPARE_SHA" ] && exit 1

# Build if any of these web-relevant paths changed
git diff --name-only "$COMPARE_SHA" HEAD -- \
  'src/' \
  'api/' \
  'server/' \
  'shared/' \
  'public/' \
  'blog-site/' \
  'pro-test/' \
  'proto/' \
  'convex/' \
  'CHANGELOG.md' \
  'docs/snapshots/' \
  'package.json' \
  'package-lock.json' \
  'vite.config.ts' \
  'tsconfig.json' \
  'tsconfig.api.json' \
  'vercel.json' \
  'middleware.ts' \
  'index.html' \
  | grep -q . && exit 1

# Nothing web-relevant changed, skip the build
exit 0
