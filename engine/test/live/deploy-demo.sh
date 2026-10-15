#!/usr/bin/env bash
# Puts this commit of the template into a demo repository made from it, keeping the demo's own content/, and
# waits for the demo's Deploy workflow to publish it to GitHub Pages. Prints the site's address last.
#
#   engine/test/live/deploy-demo.sh OWNER/REPO
#
# Pushes over SSH (a deploy key with write access, in CI); reads the demo's workflow runs with gh.
set -euo pipefail

demo=${1:?usage: deploy-demo.sh OWNER/REPO}
sha=$(git rev-parse HEAD)
work=$(mktemp -d)
# Git LFS stays out of it, so the demo's content/ goes back exactly as it is stored.
nolfs=(-c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false)

git "${nolfs[@]}" clone -q "git@github.com:$demo.git" "$work"
# Everything but content/ is replaced by this commit's, as "Use this template" would give it today.
git -C "$work" rm -q -r -- . ':!content'
git archive HEAD -- $(git ls-tree --name-only HEAD | grep -vx content) | tar -x -C "$work"
# Its workflows call the template's steps at the v0 tag, the last release: here they call this commit's instead.
sed -i.orig -E "s#(uses: [^ ]+/\.github/workflows/[^@ ]+)@v0\$#\1@$sha#" "$work"/.github/workflows/*.yml
rm "$work"/.github/workflows/*.orig
git -C "$work" "${nolfs[@]}" add -A

if git -C "$work" diff --cached --quiet; then
  echo "$demo already holds this template."
else
  deploys=$(git -C "$work" diff --cached --name-only -- engine package.json package-lock.json .github/workflows/deploy.yml)
  git -C "$work" -c user.name="WhatIIIF live test" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "Template at $sha"
  git -C "$work" "${nolfs[@]}" push -q origin HEAD
  pushed=$(git -C "$work" rev-parse HEAD)
  echo "Pushed the template at $sha to $demo as $pushed."

  if [[ -n "$deploys" ]]; then
    run=
    for _ in $(seq 1 60); do
      run=$(gh run list -R "$demo" --workflow Deploy --commit "$pushed" --json databaseId --jq '.[0].databaseId // empty')
      [[ -n "$run" ]] && break
      sleep 5
    done
    if [[ -z "$run" ]]; then
      echo "$demo's Deploy workflow did not start for $pushed." >&2
      exit 1
    fi
    echo "Waiting for https://github.com/$demo/actions/runs/$run"
    if ! gh run watch "$run" -R "$demo" --exit-status --interval 10 > /dev/null; then
      echo "$demo's Deploy failed: https://github.com/$demo/actions/runs/$run" >&2
      exit 1
    fi
  fi
fi

owner=$(echo "${demo%%/*}" | tr '[:upper:]' '[:lower:]')
echo "https://$owner.github.io/${demo#*/}/"
