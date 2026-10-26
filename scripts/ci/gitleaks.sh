#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

test "$(git rev-parse --is-shallow-repository)" = false
mkdir -p reports
result=0
gitleaks dir . --redact=100 --no-banner --report-format junit \
  --report-path reports/gitleaks-worktree.xml || result=1
gitleaks git . --redact=100 --no-banner --report-format junit \
  --report-path reports/gitleaks-history.xml || result=1
exit "$result"
