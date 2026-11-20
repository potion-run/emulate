#!/usr/bin/env bash
# Vendor shallow git source mirrors under .agent_sources/github.com/<owner>/<repo>.
# Reference-only — never a runtime dependency, never typechecked, never linted.
# Refresh: ./scripts/vendor-agent-sources.sh --refresh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${ROOT}/.agent_sources/github.com"
REFRESH=false

for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=true ;;
    -h | --help)
      echo "Usage: $0 [--refresh]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

clone_source() {
  local owner="$1" repo="$2" remote="$3" ref="$4" note="${5:-}"
  local dest="${PREFIX}/${owner}/${repo}"
  local metadata="${dest}/.agent-source.json"
  local commit=""

  if [[ -d "${dest}/.git" ]]; then
    if [[ "$REFRESH" != true ]]; then
      echo "skip ${owner}/${repo} (exists; pass --refresh to replace)"
      return 0
    fi
    rm -rf "$dest"
  elif [[ -e "$dest" ]]; then
    rm -rf "$dest"
  fi

  mkdir -p "$(dirname "$dest")"
  echo "clone ${owner}/${repo} @ ${ref}"
  git clone --depth 1 --branch "$ref" "$remote" "$dest"
  commit="$(git -C "$dest" rev-parse HEAD)"

  cat >"$metadata" <<EOF
{
  "type": "github-repo-source",
  "owner": "${owner}",
  "repo": "${repo}",
  "remote": "${remote}",
  "ref": "${ref}",
  "commit": "${commit}",
  "addedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "note": "${note:-Project-local shallow git source mirror. Refresh: ./scripts/vendor-agent-sources.sh --refresh}"
}
EOF

  echo "  -> ${dest} (${commit})"
}

# The Effect version this package compiles against is its peer pin, so a bump in
# package.json is a bump here.
EFFECT_VERSION="$(node -p "require('${ROOT}/package.json').peerDependencies.effect")"

# Alchemy is not a dependency: it is the design reference this package follows
# (the BetterAuth integration, the platform-layer split, the publish map). The
# ref is the release the API was designed against.
ALCHEMY_REF="v2.0.0-beta.87"

# emulate's GitHub tags are `v<version>`, so the dependency pin is the ref.
EMULATE_VERSION="$(node -p "require('${ROOT}/package.json').dependencies.emulate")"

clone_source Effect-TS effect https://github.com/Effect-TS/effect.git "effect@${EFFECT_VERSION}" \
  "Effect v4 monorepo matching the effect peer pin. Read src/http, src/Context.ts, src/Layer.ts."
clone_source alchemy-run alchemy https://github.com/alchemy-run/alchemy.git "${ALCHEMY_REF}" \
  "Alchemy matching ${ALCHEMY_REF}. Read packages/better-auth/src for the integration shape this package follows."
clone_source vercel-labs emulate https://github.com/vercel-labs/emulate.git "v${EMULATE_VERSION}" \
  "emulate matching the emulate dependency pin. Read packages/emulate/src for service, seed, and lifecycle behavior."

echo "done — agent sources under ${PREFIX}"
