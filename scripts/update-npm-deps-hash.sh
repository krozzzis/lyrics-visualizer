#!/usr/bin/env bash
# Regenerates flake.nix's npmDepsHash from the current package-lock.json.
# Run manually after touching dependencies, or automatically via the
# pre-commit hook installed by scripts/install-git-hooks.sh — either way
# this is what keeps `nix build` from breaking on a stale hash (see
# CLAUDE.md's Commands section).
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

new_hash="$(nix run nixpkgs#prefetch-npm-deps -- package-lock.json 2>/dev/null)"
old_hash="$(grep -oE 'npmDepsHash = "sha256-[^"]+"' flake.nix | head -1 | sed -E 's/.*"(sha256-[^"]+)".*/\1/')"

if [ "$new_hash" = "$old_hash" ]; then
  echo "npmDepsHash already up to date ($new_hash)"
  exit 0
fi

sed -i "s|npmDepsHash = \"$old_hash\"|npmDepsHash = \"$new_hash\"|" flake.nix
echo "npmDepsHash: $old_hash -> $new_hash"
