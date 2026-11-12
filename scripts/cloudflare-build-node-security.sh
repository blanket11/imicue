#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages の node-build が 24.22.3 を提供するまでの暫定措置。
version=24.22.3
archive="node-v${version}-linux-x64.tar.xz"
checksum=4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Linux x86_64 is required' >&2; exit 1; }
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
curl --fail --show-error --location --proto '=https' --tlsv1.2 --retry 3 \
  "https://nodejs.org/dist/v${version}/${archive}" -o "$work_dir/$archive"
printf '%s  %s\n' "$checksum" "$work_dir/$archive" | sha256sum --check --status
echo "Node.js archive SHA-256 verified: ${checksum}"
tar -xJf "$work_dir/$archive" -C "$work_dir"
export PATH="$work_dir/node-v${version}-linux-x64/bin:$PATH"
hash -r
[[ $(node --version) == "v${version}" ]]
echo "Build Node.js $(node --version)"
echo "Node.js executable: $(command -v node)"
npx --yes --package=npm@11.9.0 -c 'npm --version && npm ci --include=dev && npm run build:site && npm run check:site'
