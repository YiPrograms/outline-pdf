#!/bin/sh
set -eu
if [ "${ADVANCED_PRINT_ENABLED:-false}" = true ]; then
  node /opt/outline-pdf/apply.cjs /opt/outline
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"
