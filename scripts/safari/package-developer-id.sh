#!/bin/bash
# Explicit stages: rerun a finish stage to query an existing submission.
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd -P)/package-developer-id.mjs" "$@"
