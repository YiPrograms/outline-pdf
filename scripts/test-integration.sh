#!/bin/sh
set -eu
umask 077
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
mode=${1:-both}
case "$mode" in
  both) sh "$0" patcher; sh "$0" outline; exit 0;;
  patcher) override=compose.print.yaml; build_service=outline-print;;
  outline) override=compose.outline.yaml; build_service=outline;;
  *) echo "Usage: sh scripts/test-integration.sh [patcher|outline|both]" >&2; exit 1;;
esac
mkdir -p tmp output/print
work=$(mktemp -d "$root/tmp/integration-check.XXXXXX")
printf 'Testing %s deployment. Evidence: %s\n' "$mode" "$work"
project="outline-pdf-check-$(date +%s)-$$"
node --input-type=module - "$work/env" <<'JS'
import {writeFileSync} from 'node:fs'; import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
const socket=createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const hex=()=>randomBytes(32).toString('hex');
writeFileSync(process.argv[2],`URL=http://127.0.0.1:${port}\nSECRET_KEY=${hex()}\nUTILS_SECRET=${hex()}\nPOSTGRES_PASSWORD=${hex()}\nPORT=${port}\nFORCE_HTTPS=false\n`,{mode:0o600});
JS
while IFS='=' read -r key value; do export "$key=$value"; done < "$work/env"
# Build is a maintainer step. Consumer startup below runs from a new directory
# containing only a resolved Compose file, with no source checkout or builds.
build_compose() { docker compose -p "$project" -f "$root/deploy/compose.build.yaml" "$@"; }
mkdir "$work/deploy"
cp "$root/deploy/compose.test.yaml" "$work/deploy/compose.yaml"
cp "$root/deploy/$override" "$work/deploy/compose.override.yaml"
docker compose --env-file "$work/env" -p "$project" -f "$work/deploy/compose.yaml" config --format json > "$work/base.json"
docker compose --env-file "$work/env" -p "$project" -f "$work/deploy/compose.yaml" -f "$work/deploy/compose.override.yaml" config --format json > "$work/config.json"
node --input-type=module - "$work/config.json" "$work/deploy/compose.yaml" "$mode" <<'JS'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const versions=JSON.parse(readFileSync('versions.json','utf8'));
const version=versions.outline.tag.replace(/^v/,'');
if(process.argv[4]==='patcher') {
assert.equal(config.services.outline.image,versions.outline.image);
assert.equal(config.services['outline-print'].image,versions.distribution.image+':patcher-'+version);
assert.equal(config.services['outline-print'].network_mode,'none');
const expected=path.join(path.dirname(process.argv[3]),'data','outline-print','patches',version);
assert.ok(!existsSync(expected));
assert.deepEqual(Object.keys(config.services).sort(),['outline','outline-print','postgres','redis']);
assert.equal(config.services.outline.depends_on['outline-print'].condition,'service_completed_successfully');
for(const [name,target] of [['outline','/opt/outline-pdf'],['outline-print','/patches']]) {
  const mount=config.services[name].volumes.find(v=>v.target===target);
  assert.equal(mount.type,'bind');assert.equal(mount.source,expected);
  assert.equal(!!mount.read_only,name==='outline');
}
} else {
  assert.deepEqual(Object.keys(config.services).sort(),['outline','postgres','redis']);
  assert.equal(config.services.outline.image,versions.distribution.image+':outline-'+version);
  assert.equal(config.services.outline.entrypoint??null,null);
  assert.equal(config.services.outline.command??null,null);
  assert.ok(!config.services.outline.volumes.some(v=>v.target==='/opt/outline-pdf'));
}
for(const service of Object.values(config.services)) {assert.ok(service.image);assert.ok(!service.build);}
config.services.outline.environment.RATE_LIMITER_ENABLED='false';
writeFileSync(process.argv[3],JSON.stringify(config,null,2),{mode:0o600});
JS
rm "$work/deploy/compose.override.yaml"
compose() { (cd "$work/deploy" && docker compose -p "$project" "$@"); }
cleanup() {
  result=$?
  rm -f "$work/ui-credentials.json"
  compose logs --no-color > "$work/containers.log" 2>&1 || true
  if [ "$result" -ne 0 ]; then
    printf 'Integration test failed. Diagnostics: %s\n' "$work" >&2
    for log in build pull startup publisher hook-checks outline-image smoke browser rollback containers; do
      if [ -f "$work/$log.log" ]; then
        printf '\n%s.log\n' "$log" >&2
        tail -n 60 "$work/$log.log" >&2
      fi
    done
  fi
  if [ "$result" -ne 0 ] && [ "${PRINT_TEST_RETAIN_ON_FAILURE:-false}" = true ]; then
    echo "Retained disposable test project $project for diagnosis: $work" >&2
    return
  fi
  case "$project" in outline-pdf-check-*) compose down --volumes --remove-orphans > "$work/cleanup.log" 2>&1 || true;; esac
}
trap cleanup EXIT HUP INT TERM
if [ "${PRINT_TEST_SKIP_BUILD:-false}" != true ]; then build_compose build "$build_service" > "$work/build.log" 2>&1; fi
docker compose -p "$project" -f "$work/base.json" pull outline postgres redis > "$work/pull.log" 2>&1
compose up -d --no-build --pull never > "$work/startup.log" 2>&1
container=$(compose ps -q outline)
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$container" node -e 'fetch("http://127.0.0.1:3000/_health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo "Outline startup failed; see $work/startup.log" >&2; exit 1; fi
if [ "$mode" = patcher ]; then
publisher=$(compose ps -a -q outline-print)
node scripts/check-publisher.mjs "$publisher" "$project" > "$work/publisher.json" 2> "$work/publisher.log"
patchdir=$(node --input-type=module -e 'import fs from "node:fs";const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(c.services.outline.volumes.find(v=>v.target==="/opt/outline-pdf").source)' "$work/deploy/compose.yaml")
docker run --rm --network none -v "$patchdir:/opt/outline-pdf:ro" -v "$root/scripts/check-hook.cjs:/tmp/check-hook.cjs:ro" --entrypoint node "$(node -p 'require("./versions.json").outline.image')" /tmp/check-hook.cjs > "$work/hook-checks.json" 2> "$work/hook-checks.log"
else
node scripts/check-outline-image.mjs "$container" > "$work/outline-image.json" 2> "$work/outline-image.log"
fi
PRINT_TEST_FIXTURE="$work/fixture.json" node_modules/.bin/tsx -e 'import {fixtureBook} from "./fixtures/book.ts"; import {writeFileSync} from "node:fs"; writeFileSync(process.env.PRINT_TEST_FIXTURE, JSON.stringify(fixtureBook()));'
chmod 644 "$work/fixture.json"
docker cp "$work/fixture.json" "$container:/tmp/print-fixture.json"
docker cp scripts/integration-smoke.cjs "$container:/tmp/print-smoke.cjs"
docker exec "$container" node /tmp/print-smoke.cjs > "$work/smoke.log" 2>&1
docker cp "$container:/tmp/print-ui-test.json" "$work/ui-credentials.json"
chmod 600 "$work/ui-credentials.json"
port=$(compose port outline 3000)
node scripts/check-browser.mjs "http://$port" "$work/ui-credentials.json" "$work" > "$work/browser.log" 2>&1
rm "$work/ui-credentials.json"
docker cp "$container:/tmp/print-integration-snapshot.json" output/print/integrated-snapshot.json
docker cp "$container:/tmp/print-integration-report.json" output/print/integration-report.json
# Removing the print settings must recreate the same official application
# with its original data volumes. This uses only the saved base Compose file.
docker compose -p "$project" -f "$work/base.json" up -d --force-recreate outline > "$work/rollback.log" 2>&1
rolled=$(compose ps -q outline)
restored=false
for attempt in $(seq 1 60); do
  if docker exec "$rolled" node -e 'fetch("http://127.0.0.1:3000/_health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then restored=true; break; fi
  sleep 1
done
if [ "$restored" != true ]; then echo "Rollback startup failed; see $work/rollback.log" >&2; exit 1; fi
node --input-type=module - "$rolled" <<'JS'
import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const [container]=JSON.parse(execFileSync('docker',['inspect',process.argv[2]],{encoding:'utf8'}));
const versions=JSON.parse(readFileSync('versions.json','utf8'));
assert.equal(container.Config.Image,versions.outline.image);
assert.ok(!container.Mounts.some(m=>m.Destination==='/opt/outline/build'));
assert.ok(!container.Config.Env.some(e=>e.startsWith('ADVANCED_PRINT_ENABLED=')));
execFileSync('docker',['exec',process.argv[2],'node','-e',"const fs=require('fs');require('assert/strict').equal(fs.existsSync('/opt/outline/.outline-pdf-patch.json'),false)"]);
JS
if [ "$mode" = patcher ]; then
  cat "$work/publisher.json" "$work/hook-checks.json"
else
  cat "$work/outline-image.json"
fi
cat "$work/browser-checks.json"
cat output/print/integration-report.json
echo "$mode deployment startup and rollback passed. Detailed evidence: $work"
