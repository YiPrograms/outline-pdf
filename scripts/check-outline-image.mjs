import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const [containerId] = process.argv.slice(2);
assert.ok(containerId, "Pass a running integration-test Outline container");
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
const [container] = JSON.parse(docker(["inspect", containerId]));
const [upstream] = JSON.parse(
  docker(["image", "inspect", versions.outline.image]),
);
const [image] = JSON.parse(docker(["image", "inspect", container.Image]));
for (const key of ["User", "Entrypoint", "Cmd", "Healthcheck", "WorkingDir"])
  assert.deepEqual(
    image.Config[key],
    upstream.Config[key],
    `Preserve upstream ${key}`,
  );
assert.ok(image.Config.User && image.Config.User !== "root");
assert.ok(!container.Mounts.some((m) => m.Destination === "/opt/outline-pdf"));

// Verify the build-time result on a read-only filesystem, without a patch mount
// or startup installer. Verify the running service has the identical result.
const probe = `
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const file='/opt/outline/.outline-pdf-patch.json';
const state=JSON.parse(fs.readFileSync(file));
assert.equal(state.status,'complete');
for(const item of state.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync('/opt/outline/'+item.path)).digest('hex'),item.after,item.path);
assert.equal(fs.existsSync('/tmp/outline-pdf'),false);
assert.equal(fs.existsSync('/opt/outline-pdf'),false);
assert.ok(fs.existsSync('/opt/outline-pdf-notices/THIRD_PARTY_NOTICES.md'));
console.log(state.id);
`;
const built = docker([
  "run",
  "--rm",
  "--read-only",
  "--network",
  "none",
  "--entrypoint",
  "node",
  container.Image,
  "-e",
  probe,
]).trim();
const running = docker(["exec", containerId, "node", "-e", probe]).trim();
assert.equal(running, built);
console.log(
  JSON.stringify({
    status: "passed",
    officialStartupPreserved: true,
    nonRootRuntime: true,
    patchBakedIntoImage: true,
    patchIntegrityVerified: true,
    noPatchMount: true,
    buildAndRunningPatchId: built,
  }),
);
