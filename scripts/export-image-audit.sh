#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: scripts/export-image-audit.sh IMAGE [OUTPUT_DIRECTORY]}"
output_directory="${2:-var/ci-evidence/image-audit}"
mkdir -p "$output_directory"

container="$(docker create "$image")"
cleanup() {
    docker rm "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker cp "$container:/usr/share/falkenwarte/image-audit/." "$output_directory/"
docker image inspect "$image" > "$output_directory/.image-inspect.json"

revision="$(jq -er '.application.revision' "$output_directory/runtime-evidence.json")"
version="$(jq -er '.application.version' "$output_directory/runtime-evidence.json")"
jq -e --arg revision "$revision" --arg version "$version" '
  .[0].Config.Labels["org.opencontainers.image.revision"] == $revision
  and .[0].Config.Labels["org.opencontainers.image.version"] == $version
' "$output_directory/.image-inspect.json" >/dev/null

sbom_sha256="$(sha256sum "$output_directory/sbom.cdx.json" | cut -d ' ' -f 1)"
test "$sbom_sha256" = "$(jq -er '.inventory.sbom_sha256' "$output_directory/runtime-evidence.json")"
jq --arg ref "$image" --arg sbom "$sbom_sha256" '
  .[0] as $image |
  {
    format: "falkenwarte.image-audit-evidence.v1",
    image: {
      reference: $ref,
      image_id: $image.Id,
      platform: ($image.Os + "/" + $image.Architecture),
      repo_digests: ($image.RepoDigests // []),
      revision: $image.Config.Labels["org.opencontainers.image.revision"],
      version: $image.Config.Labels["org.opencontainers.image.version"]
    },
    inventory: {
      sbom_file: "sbom.cdx.json",
      sbom_sha256: $sbom,
      runtime_evidence_file: "runtime-evidence.json",
      notices_file: "THIRD-PARTY-NOTICES.txt"
    }
  }
' "$output_directory/.image-inspect.json" > "$output_directory/image-evidence.json"
rm -f "$output_directory/.image-inspect.json"
