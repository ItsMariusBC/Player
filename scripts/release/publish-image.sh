#!/bin/sh
# Construit et publie l'image Player sur GHCR depuis un poste, sans GitHub Actions.
# Usage : scripts/release/publish-image.sh [vX.Y.Z]
#   Sans argument, le tag est lu sur le commit courant (git describe --exact-match).
# Variables : IMAGE (défaut ghcr.io/itsmariusbc/player), PLATFORMS (défaut linux/amd64,linux/arm64),
#   DRY_RUN=1 pour construire sans pousser (une seule plateforme, chargée dans Docker).
# Prérequis : docker buildx, et `docker login ghcr.io` fait au préalable (jeton avec write:packages).
set -eu

cd "$(dirname "$0")/../.."

image="${IMAGE:-ghcr.io/itsmariusbc/player}"
platforms="${PLATFORMS:-linux/amd64,linux/arm64}"
tag="${1:-$(git describe --tags --exact-match 2>/dev/null || true)}"

fail() {
  echo "publish-image: $*" >&2
  exit 1
}

[ -n "$tag" ] || fail "aucun tag vX.Y.Z sur ce commit ; passer le tag en argument"
case "$tag" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "tag inattendu « $tag » (attendu vX.Y.Z ou vX.Y.Z-suffixe)" ;;
esac
git rev-parse -q --verify "refs/tags/$tag" > /dev/null || fail "le tag $tag n'existe pas dans ce dépôt"
[ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse HEAD)" ] || fail "HEAD n'est pas sur $tag"
[ -z "$(git status --porcelain)" ] || fail "arbre de travail non propre"

version="${tag#v}"
minor="${version%.*}"
sha="sha-$(git rev-parse --short=7 HEAD)"
created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
source="https://github.com/${image#ghcr.io/}"

set -- \
  --tag "$image:$version" \
  --tag "$image:$sha" \
  --label "org.opencontainers.image.title=Player" \
  --label "org.opencontainers.image.description=Lecteur musical privé : interface web et API sur une seule image." \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  --label "org.opencontainers.image.created=$created" \
  --label "org.opencontainers.image.source=$source" \
  --label "org.opencontainers.image.licenses=UNLICENSED"

case "$version" in
  *-*) ;;
  *) set -- "$@" --tag "$image:$minor" --tag "$image:latest" ;;
esac

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "publish-image: essai à blanc, construction locale sans envoi"
  docker buildx build --load "$@" .
  exit 0
fi

docker buildx build --platform "$platforms" --push --provenance=false "$@" .

echo
echo "Image publiée : $image:$version"
docker buildx imagetools inspect "$image:$version" | head -20
