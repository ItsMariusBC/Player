#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

export TRIVY_DISABLE_TELEMETRY=true TRIVY_SKIP_VERSION_CHECK=true
export TRIVY_NO_PROGRESS=true TRIVY_TIMEOUT=15m
mkdir -p reports
case "${1:-}" in
  vuln)
    trivy fs . --skip-dirs .git,dist,reports,playwright-report,test-results \
      --scanners vuln --include-dev-deps --severity HIGH,CRITICAL --ignore-unfixed=false \
      --format json --output reports/trivy-vuln.json
    trivy convert --scanners vuln --format cyclonedx \
      --output reports/trivy-sbom.cdx.json reports/trivy-vuln.json
    ;;
  license)
    trivy fs . --skip-dirs .git,dist,reports,playwright-report,test-results \
      --scanners license --include-dev-deps --license-full --format json --output reports/trivy-license.json
    ;;
  *) echo 'usage: sh scripts/ci/trivy.sh vuln|license' >&2; exit 2 ;;
esac
trivy convert --severity HIGH,CRITICAL --format template --template @/contrib/junit.tpl \
  --output "reports/trivy-$1.xml" "reports/trivy-$1.json"
trivy convert --scanners "$1" --severity HIGH,CRITICAL --exit-code 1 "reports/trivy-$1.json"
