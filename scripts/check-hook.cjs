// Runs in a fresh, disposable official image without a database or network.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const { applyPatch } = require("/opt/outline-pdf/apply.cjs");
const root = "/opt/outline",
  build = path.join(root, "build");
function snapshot() {
  const result = {};
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else
        result[path.relative(build, file)] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  }
  walk(build);
  return result;
}
const original = snapshot();
// A hard interruption leaves an applying transaction. A check must remain
// read-only; the real entrypoint recovers the transaction before replanning.
const crashProgram = `const fs=require('fs');const rename=fs.renameSync;let writes=0;fs.renameSync=(a,b)=>{if(b.includes('/build/')&&++writes===2)process.exit(73);return rename(a,b)};require('/opt/outline-pdf/apply.cjs').applyPatch('/opt/outline','/opt/outline-pdf');`;
const crashed = spawnSync("node", ["-e", crashProgram], { encoding: "utf8" });
assert.equal(crashed.status, 73);
const partial = snapshot();
assert.throws(
  () => applyPatch(root, "/opt/outline-pdf", { dryRun: true }),
  /needs recovery/,
);
assert.deepEqual(snapshot(), partial);
applyPatch(root, "/opt/outline-pdf");
const recovered = JSON.parse(
  fs.readFileSync(root + "/.outline-pdf-patch.json", "utf8"),
);
assert.equal(recovered.status, "complete");
// Reset this disposable image to test the other failure modes independently.
for (const file of recovered.files) {
  const target = path.join(root, file.path);
  if (file.original === null) fs.rmSync(target, { force: true });
  else fs.writeFileSync(target, Buffer.from(file.original, "base64"));
}
fs.rmSync(root + "/.outline-pdf-patch.json");
assert.deepEqual(snapshot(), original);
const target = path.join(build, "server/env.js"),
  envSource = fs.readFileSync(target, "utf8");
fs.writeFileSync(
  target,
  envSource.replace(
    "let Environment = class Environment {",
    "let RenamedEnvironment = class Environment {",
  ),
);
const incompatible = snapshot();
const rejected = spawnSync(
  "sh",
  [
    "/opt/outline-pdf/entrypoint.sh",
    "node",
    "-e",
    "require('fs').writeFileSync('/tmp/should-not-start','bad')",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, ADVANCED_PRINT_ENABLED: "true" },
  },
);
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /Incompatible Outline integration point/);
assert.ok(!fs.existsSync("/tmp/should-not-start"));
assert.ok(!fs.existsSync(root + "/.outline-pdf-patch.json"));
assert.deepEqual(snapshot(), incompatible);
fs.writeFileSync(target, envSource);

const rename = fs.renameSync;
let writes = 0;
fs.renameSync = (source, destination) => {
  if (destination.includes("/build/") && ++writes === 2)
    throw new Error("injected write failure");
  return rename(source, destination);
};
try {
  assert.throws(
    () => applyPatch(root, "/opt/outline-pdf"),
    /injected write failure/,
  );
} finally {
  fs.renameSync = rename;
}
assert.deepEqual(snapshot(), original);
assert.ok(!fs.existsSync(root + "/.outline-pdf-patch.json"));

const packageFile = root + "/package.json",
  packageSource = fs.readFileSync(packageFile, "utf8");
fs.writeFileSync(
  packageFile,
  JSON.stringify({
    ...JSON.parse(packageSource),
    version: "99.0.0-test-metadata",
  }),
);
assert.equal(
  applyPatch(root, "/opt/outline-pdf", { dryRun: true }).outlineVersion,
  "99.0.0-test-metadata",
);
assert.deepEqual(snapshot(), original);
fs.writeFileSync(packageFile, packageSource);

const args = [
  "/opt/outline-pdf/entrypoint.sh",
  "node",
  "-e",
  "console.log('ORIGINAL_COMMAND_PRESERVED:'+process.getuid())",
];
for (let i = 0; i < 2; i++) {
  const result = spawnSync("sh", args, {
    encoding: "utf8",
    env: { ...process.env, ADVANCED_PRINT_ENABLED: "true" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ORIGINAL_COMMAND_PRESERVED:1001/);
  assert.ok(
    result.stdout.includes(
      i === 0 ? '"status":"applied"' : '"status":"already-applied"',
    ),
  );
}
const state = JSON.parse(
  fs.readFileSync(root + "/.outline-pdf-patch.json", "utf8"),
);
const changed = new Set(
  state.files
    .filter((f) => f.original !== null)
    .map((f) => f.path.replace(/^build\//, "")),
);
const current = snapshot();
for (const [name, digest] of Object.entries(original)) {
  assert.ok(current[name], "Original file was removed: " + name);
  if (!changed.has(name))
    assert.equal(
      current[name],
      digest,
      "Unrelated official file changed: " + name,
    );
}
const manifest = JSON.parse(
  fs.readFileSync("/opt/outline-pdf/manifest.json", "utf8"),
);
const packetBytes = Object.keys(manifest.files).reduce(
  (n, name) => n + fs.statSync("/opt/outline-pdf/" + name).size,
  0,
);
console.log(
  JSON.stringify({
    status: "passed",
    incompatibleHookBlocksCommand: true,
    preflightMakesNoChanges: true,
    writeFailureRollsBack: true,
    interruptedPatchRecovers: true,
    interruptedCheckRemainsReadOnly: true,
    noExactVersionGate: true,
    customCommandPreserved: true,
    outlineRestartIdempotent: true,
    originalFilesPreserved: Object.keys(original).length - changed.size,
    modifiedOriginalFiles: changed.size,
    newPatchFiles: state.files.length - changed.size,
    patchPackageBytes: packetBytes,
  }),
);
