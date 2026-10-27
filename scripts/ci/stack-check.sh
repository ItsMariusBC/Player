#!/bin/sh
# Contrôles de la pile Compose démarrée avec docker-compose.ci.yml.
# Variables : COMPOSE_FILE (fichiers Compose), STACK_URL (défaut http://127.0.0.1:8080).
set -eu

base="${STACK_URL:-http://127.0.0.1:8080}"
issuer="http://host.docker.internal:3002"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "stack-check: $*" >&2
  exit 1
}

# status <fichier de sortie> <chemin> [options curl] : affiche le code HTTP.
status() {
  out="$1"
  path="$2"
  shift 2
  curl -sS -o "$out" -D "$out.headers" -w '%{http_code}' "$@" "$base$path"
}

expect_status() {
  want="$1"
  path="$2"
  shift 2
  got="$(status "$tmp/body" "$path" "$@")" || fail "$path : requête impossible"
  [ "$got" = "$want" ] || fail "$path : code $got, attendu $want"
}

expect_status 200 /healthz
[ "$(cat "$tmp/body")" = ok ] || fail "/healthz : corps différent de 'ok'"

expect_status 200 /
grep -q '<div id="root">' "$tmp/body" || fail "/ : <div id=\"root\"> absent"

expect_status 401 /api/session
grep -Eq '"code" *: *"session_required"' "$tmp/body" \
  || fail "/api/session : error.code différent de session_required"

expect_status 302 /api/auth/login
location="$(tr -d '\r' < "$tmp/body.headers" | sed -n 's/^[Ll]ocation: //p' | head -n 1)"
case "$location" in
  "$issuer/auth"*) ;;
  *) fail "/api/auth/login : Location '$location' ne commence pas par $issuer/auth" ;;
esac

expect_status 404 /assets/
expect_status 404 /server/main.js

# Range sur un média statique, conservé jusqu'à l'incrément 2 (médias privés).
expect_status 206 /Drops.mp3 -H 'Range: bytes=0-127'
grep -qi '^content-range: bytes 0-127/' "$tmp/body.headers" \
  || fail "/Drops.mp3 : Content-Range absent"
[ "$(wc -c < "$tmp/body" | tr -d ' ')" -eq 128 ] || fail "/Drops.mp3 : 128 octets attendus"

uid="$(docker compose exec -T player id -u | tr -d '\r')"
[ "$uid" = 101 ] || fail "uid $uid, attendu 101"

if docker compose exec -T player sh -c 'touch /app/x' 2>/dev/null; then
  fail "/app doit être en lecture seule"
fi

echo "stack-check: ok"
