import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [publisher, project] = process.argv.slice(2);
assert.match(project ?? "", /^outline-pdf-check-[0-9]+-[0-9]+$/);
const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 30000 });
const [container] = JSON.parse(docker(["inspect", publisher]));
assert.equal(container.State.Status, "exited");
assert.equal(container.State.ExitCode, 0);
assert.equal(container.HostConfig.NetworkMode, "none");
const directory = container.Mounts.find(
  (mount) => mount.Destination === "/patches",
).Source;
const marker = directory + "/.pdf-patch-id";
const before = fs.statSync(marker);
assert.equal(before.uid, 1000);
const identity = fs.readFileSync(marker, "utf8");
const restarted = docker(["start", "--attach", publisher]);
assert.match(restarted, /already published/);
assert.equal(fs.statSync(marker).mtimeMs, before.mtimeMs);
assert.equal(fs.readFileSync(marker, "utf8"), identity);
const volume = `${project}-incompatible-patch`;
try {
  docker(["volume", "create", volume]);
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${volume}:/patches`,
    "--entrypoint",
    "node",
    container.Config.Image,
    "-e",
    "require('fs').writeFileSync('/patches/.pdf-patch-id','incompatible')",
  ]);
  assert.throws(
    () =>
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${volume}:/patches`,
        container.Config.Image,
      ]),
    /Command failed/,
  );
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${volume}:/patches`,
    "--entrypoint",
    "node",
    container.Config.Image,
    "-e",
    "const fs=require('fs');require('assert/strict').deepEqual(fs.readdirSync('/patches'),['.pdf-patch-id']);",
  ]);
} finally {
  docker(["volume", "rm", volume]);
}
console.log(
  JSON.stringify({
    status: "passed",
    initializerExitsSuccessfully: true,
    offline: true,
    patchOwnedByNonRoot: true,
    idempotent: true,
    incompatiblePackagePreserved: true,
  }),
);
