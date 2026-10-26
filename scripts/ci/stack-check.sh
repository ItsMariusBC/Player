#!/bin/sh
set -eu

docker compose exec -T player sh -eu <<'SH'
test "$(id -u)" != 0
test "$(wget -qO- http://127.0.0.1:8080/healthz)" = ok
wget -qO- http://127.0.0.1:8080/ | grep -q '<div id="root"'

# Le wget BusyBox de l’image refuse les réponses 206 ; lire la réponse HTTP avec nc.
printf 'GET /Untouchable.mp3 HTTP/1.1\r\nHost: localhost\r\nRange: bytes=0-127\r\nConnection: close\r\n\r\n' \
  | nc -w 5 127.0.0.1 8080 > /tmp/player-response
grep -q '206 Partial Content' /tmp/player-response
grep -q 'Content-Range: bytes 0-127/' /tmp/player-response
header_size=$(awk 'BEGIN { RS="\r\n\r\n" } NR==1 { print length($0)+4; exit }' /tmp/player-response)
response_size=$(wc -c < /tmp/player-response)
test "$((response_size - header_size))" -eq 128

if wget -S -O /dev/null http://127.0.0.1:8080/missing.mp3 2>/tmp/player-missing; then
  echo 'Un média absent doit répondre 404.' >&2
  exit 1
fi
grep -q '404 Not Found' /tmp/player-missing
SH
