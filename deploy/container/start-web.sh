#!/bin/sh
# Web container: the public endpoint. Lightsail routes HTTPS traffic to port 3000.
set -e
cd apps/web
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
