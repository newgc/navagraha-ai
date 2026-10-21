#!/bin/sh
# API container: bring the database up to date, then serve on 127.0.0.1 (only the web
# container, which shares localhost with it, can reach it). Run one node only: migrations
# are not coordinated between several copies starting at once.
set -e
node packages/db/dist/scripts/migrate.js
node packages/db/dist/scripts/seed.js
exec node apps/api/dist/main.js
