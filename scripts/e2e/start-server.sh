#!/bin/sh
# Starts the built API server once the mock OIDC provider answers discovery.
set -eu

data_dir="${DATA_DIR:-./.data/e2e}"
case "$data_dir" in
  *..*)
    echo "Refusing to wipe DATA_DIR containing '..': '$data_dir'" >&2
    exit 1
    ;;
  ./.data/?* | .data/?*) ;;
  *)
    echo "Refusing to wipe unsafe DATA_DIR: '$data_dir'" >&2
    exit 1
    ;;
esac

url="${MOCK_OIDC_URL:-http://127.0.0.1:3002}/.well-known/openid-configuration"
i=0
until curl -fs -o /dev/null "$url"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "Mock OIDC provider did not answer at $url within 60s" >&2
    exit 1
  fi
  sleep 1
done

rm -rf "$data_dir"
exec node --no-warnings=ExperimentalWarning dist/server/main.js
