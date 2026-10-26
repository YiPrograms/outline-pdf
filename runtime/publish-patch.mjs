import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const source = "/app/patch-package",
  destination = "/patches";
const manifest = JSON.parse(
  fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
);
const marker = path.join(destination, ".pdf-patch-id");
const hash = (data) => createHash("sha256").update(data).digest("hex");
function verify(directory) {
  for (const [name, digest] of Object.entries(manifest.files))
    if (hash(fs.readFileSync(path.join(directory, name))) !== digest)
      throw new Error(`Published patch integrity failure: ${name}`);
  if (
    JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"))
      .id !== manifest.id
  )
    throw new Error("Published manifest identity mismatch");
}
if (fs.existsSync(marker)) {
  if (fs.readFileSync(marker, "utf8").trim() !== manifest.id)
    throw new Error(
      "Patch package mismatch; use a new versioned patch directory",
    );
  verify(destination);
  console.log("Patch package already published; preserving it.");
} else {
  fs.cpSync(source, destination, { recursive: true, force: true });
  function readable(directory) {
    fs.chmodSync(directory, 0o755);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) readable(file);
      else fs.chmodSync(file, 0o644);
    }
  }
  readable(destination);
  verify(destination);
  fs.writeFileSync(marker + ".tmp", manifest.id + "\n", { mode: 0o644 });
  fs.renameSync(marker + ".tmp", marker);
  console.log(`Published patch-only package ${manifest.id}.`);
}
