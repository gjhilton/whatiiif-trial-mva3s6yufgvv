#!/usr/bin/env bash
# Pulls the latest template release into this repo and opens a pull request.
# Only upstream-owned files are replaced (engine/, package.json, package-lock.json);
# everything in content/ is yours and is never touched.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/versions.sh"

UPSTREAM=$(tr -d '[:space:]' < engine/UPSTREAM)
if [[ "$UPSTREAM" != */* || "$UPSTREAM" == OWNER/* ]]; then
  echo "engine/UPSTREAM does not name a template repository (expected OWNER/REPO); nothing to update from." >&2
  exit 1
fi
if [[ "$UPSTREAM" == "${GITHUB_REPOSITORY:-}" ]]; then
  echo "This repository is the template itself, so there is nothing to update from."
  exit 0
fi

current=$(tr -d '[:space:]' < engine/VERSION)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A template with no release yet has nothing to update to; any other failure is a real one.
errors="$work/errors"
if ! tag=$(gh release view --repo "$UPSTREAM" --json tagName --jq .tagName 2> "$errors"); then
  if grep -qx 'release not found' "$errors"; then
    echo "$UPSTREAM has not published a release yet, so there is nothing to update to."
    exit 0
  fi
  cat "$errors" >&2
  exit 1
fi
latest=${tag#v}
if [[ "$latest" == "$current" ]]; then
  echo "Already on the latest release ($current)."
  exit 0
fi
# A copy made from the template between two releases is ahead of the latest one. One made while the template was on a
# pre-release (1.2.0-rc.1) is behind the release that follows it (1.2.0).
if above "$current" "$latest"; then
  echo "$current is newer than the latest release ($latest), so there is nothing to update to."
  exit 0
fi

mkdir "$work/src"
gh api "repos/$UPSTREAM/tarball/$tag" > "$work/release.tgz"
tar -xzf "$work/release.tgz" --strip-components=1 -C "$work/src"

# Replace the engine outright: syncing by size and timestamp can skip a file that changed.
rm -rf engine
cp -R "$work/src/engine" engine
cp "$work/src/package.json" "$work/src/package-lock.json" .

mine="https://github.com/${GITHUB_REPOSITORY}"
theirs="https://github.com/$UPSTREAM"
base=$(git rev-parse --abbrev-ref HEAD) # the branch to update, as checked out; GITHUB_REF_NAME can name a merge ref

body="Updates the engine, preview page and tooling from **$UPSTREAM** $current → $latest. Your \`content/\` is untouched."

# GitHub does not let a workflow change workflow files, so each one that changed upstream is listed, with links, for
# the repository's owner to copy by hand. Those whose first line says "whatiiif: template only" run only in the
# template, or are called from it by copies, so they never need copying (nor, from before there was a marker, do
# ci.yml and live.yml).
copies=()
shopt -s nullglob
for file in "$work/src/.github/workflows/"*.yml "$work/src/.github/workflows/"*.yaml; do
  name=$(basename "$file")
  [[ "$name" == ci.yml || "$name" == live.yml ]] && continue
  head -1 "$file" | grep -q '^# whatiiif: template only' && continue
  copy="open [the new version]($theirs/blob/$tag/.github/workflows/$name), copy all of it, and paste it"
  if [[ ! -f ".github/workflows/$name" ]]; then
    copies+=("- \`$name\` (new): $copy into [a new file]($mine/new/$base?filename=.github/workflows/$name).")
  elif ! cmp -s "$file" ".github/workflows/$name"; then
    copies+=("- \`$name\`: $copy over [yours]($mine/edit/$base/.github/workflows/$name).")
  fi
done
if (( ${#copies[@]} )); then
  body+=$'\n\n**Copy by hand:** GitHub does not let this automation change workflow files, so please update these yourself:\n\n'
  body+=$(printf '%s\n' "${copies[@]}")
fi
body+=$'\n\nChangelog: '"$theirs/releases/tag/$tag"

branch="whatiiif-update-$latest"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -b "$branch"
git add -A engine package.json package-lock.json
git commit -m "Update WhatIIIF engine to $latest"
git push --force origin "$branch"

# Pull requests from earlier runs: one for this release is brought up to date; older updates are replaced, since
# merging one of those after this would clash with it.
open=$(gh pr list --state open --json number,headRefName --jq '.[] | "\(.number) \(.headRefName)"')
same=$(awk -v branch="$branch" '$2 == branch { print $1 }' <<< "$open")
if [[ -n "$same" ]]; then
  gh pr edit "$same" --body "$body"
  exit 0
fi
if ! url=$(gh pr create --title "Update WhatIIIF to $latest" --body "$body" --base "$base" --head "$branch" 2> "$errors"); then
  if grep -q 'not permitted to create or approve pull requests' "$errors"; then
    echo "::error title=Update $latest is ready but could not be offered::This repository does not let workflows open pull requests. Turn on Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests, then run the Update workflow again; or open the pull request yourself: $mine/compare/$base...$branch?expand=1"
  fi
  cat "$errors" >&2
  exit 1
fi
echo "Opened $url"
awk -v branch="$branch" '$2 ~ /^whatiiif-update-/ && $2 != branch { print $1 }' <<< "$open" | while read -r number; do
  gh pr close "$number" --delete-branch --comment "Replaced by $url, which updates to $latest."
done
