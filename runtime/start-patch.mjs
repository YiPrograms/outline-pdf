import { chownSync, lstatSync, readdirSync } from "node:fs";

const directory = "/patches";
const info = lstatSync(directory);
if (!info.isDirectory()) throw new Error("Patch mount must be a directory");
if (process.getuid() === 0) {
  // Compose creates missing bind directories as root. Only claim a fresh,
  // empty directory; never recursively chown existing user data.
  if (info.uid === 0 && readdirSync(directory).length === 0)
    chownSync(directory, 1000, 1000);
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}
// Initialization and patch publication run after permanently dropping
// root. The service exits after the package has been published.
await import("/app/publish-patch.mjs");
