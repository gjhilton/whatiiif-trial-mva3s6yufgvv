#!/usr/bin/env bash
# Puts this commit of the template into a demo repository made from it, keeping the demo's own content/, and
# waits for the demo's Deploy workflow to publish it to GitHub Pages. Prints the site's address last. The demo is as
# a site made from the template now would be: its workflows call the steps at the tag they name (v1 for 1.x).
#
#   engine/test/live/deploy-demo.sh OWNER/REPO
#
# Pushes over SSH (a deploy key with write access, in CI), or to DEMO_GIT_URL if set (as the tests do); reads the
# demo's workflow runs with gh.
set -euo pipefail

demo=${1:?usage: deploy-demo.sh OWNER/REPO}
sha=$(git rev-parse HEAD)
work=$(mktemp -d)
# Git LFS stays out of it, so the demo's content/ goes back exactly as it is stored.
nolfs=(-c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false)

git "${nolfs[@]}" clone -q "${DEMO_GIT_URL:-git@github.com:$demo.git}" "$work"
# Everything but content/ is replaced by this commit's, as "Use this template" would give it today.
git -C "$work" rm -q -r -- . ':!content'
git archive HEAD -- $(git ls-tree --name-only HEAD | grep -vx content) | tar -x -C "$work"
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
    # gh run watch also gives up when the network cuts it off, though the run goes on: how the run ended decides,
    # and a run not ended yet is watched again.
    conclusion=
    for _ in $(seq 1 5); do
      gh run watch "$run" -R "$demo" --interval 10 > /dev/null || true
      conclusion=$(gh run view "$run" -R "$demo" --json status,conclusion --jq 'if .status == "completed" then .conclusion else "" end' || true)
      [[ -n "$conclusion" ]] && break
      sleep 2 # gh run watch waits for the run itself: this only spaces out tries the network cut off at once
    done
    if [[ "$conclusion" != success ]]; then
      echo "$demo's Deploy ${conclusion:+ended in }${conclusion:-could not be watched to its end}: https://github.com/$demo/actions/runs/$run" >&2
      exit 1
    fi
  fi
fi

owner=$(echo "${demo%%/*}" | tr '[:upper:]' '[:lower:]')
echo "https://$owner.github.io/${demo#*/}/"
