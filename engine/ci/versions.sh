# WhatIIIF's versions, in the order semantic versioning puts them: 1.2.0-rc.1, a pre-release of 1.2.0, comes before
# it. For `source`: update.sh, and the template's .github/release.sh, use it.

# Whether version $1 is a pre-release: one with a hyphen.
prerelease() { [[ "$1" == *-* ]]; }

# Whether version $1 is above $2: by their numbers, and with the same numbers, a release above its pre-releases.
above() {
  local a=$1 b=$2 highest
  [[ "$a" == "$b" ]] && return 1
  if [[ "${a%%-*}" != "${b%%-*}" ]]; then
    highest=$(printf '%s\n%s\n' "${a%%-*}" "${b%%-*}" | sort -V | tail -1)
    [[ "$highest" == "${a%%-*}" ]]
  elif ! prerelease "$a"; then
    return 0
  elif ! prerelease "$b"; then
    return 1
  else
    highest=$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -1)
    [[ "$highest" == "$a" ]]
  fi
}
