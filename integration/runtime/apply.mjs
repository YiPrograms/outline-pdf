import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parse } from "acorn";
import { serverRules } from "./server-rules.mjs";
import { planFrontend } from "./frontend.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
function safe(root, relative) {
  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((p) => p === ".." || !p)
  )
    throw new Error("Unsafe patch path");
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Symlink patch target: ${relative}`);
  }
  return current;
}
function atomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + `.pdf-tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o644 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
function restore(root, state) {
  for (const item of state.files) {
    const file = safe(root, item.path);
    if (fs.existsSync(file)) {
      const current = hash(fs.readFileSync(file));
      if (current !== item.after && current !== item.before)
        throw new Error(
          `Cannot recover a manually modified file: ${item.path}`,
        );
    }
  }
  for (const item of state.files) {
    const file = safe(root, item.path);
    if (item.original === null) fs.rmSync(file, { force: true });
    else atomic(file, Buffer.from(item.original, "base64"));
    if (Number.isSafeInteger(state.pid) && state.pid > 0)
      fs.rmSync(file + `.pdf-tmp-${state.pid}`, { force: true });
  }
}

/** Validate the complete plan before modifying the installed application. */
export function applyPatch(root, packet, { dryRun = false } = {}) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packet, "manifest.json"), "utf8"),
  );
  for (const [name, digest] of Object.entries(manifest.files))
    if (hash(fs.readFileSync(safe(packet, name))) !== digest)
      throw new Error(`Patch package integrity failure: ${name}`);
  const identity = hash(
    Object.entries(manifest.files)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([n, h]) => n + ":" + h + "\n")
      .join(""),
  );
  if (identity !== manifest.id)
    throw new Error("Patch package identity mismatch");
  const stateFile = path.join(root, ".outline-pdf-patch.json");
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.status === "applying") {
      if (dryRun)
        throw new Error(
          "Interrupted patch needs recovery; restart the Outline container before checking",
        );
      restore(root, state);
      fs.rmSync(stateFile);
    } else {
      if (state.id !== manifest.id)
        throw new Error(
          "Patch changed; recreate the Outline container from its official image",
        );
      for (const item of state.files)
        if (
          !fs.existsSync(safe(root, item.path)) ||
          hash(fs.readFileSync(safe(root, item.path))) !== item.after
        )
          throw new Error(`Installed patch was modified: ${item.path}`);
      return {
        status: "already-applied",
        id: manifest.id,
        outlineVersion: state.outlineVersion,
      };
    }
  }
  const build = path.join(root, "build"),
    plan = new Map();
  const requireNative = createRequire(path.join(root, "package.json"));
  for (const dependency of ["zod", "@koa/router", "sequelize"])
    requireNative.resolve(dependency);
  for (const [relative, before, after, count = 1] of serverRules) {
    const source =
      plan.get(relative) ?? fs.readFileSync(safe(build, relative), "utf8");
    if (source.split(before).length - 1 !== count)
      throw new Error(
        `Incompatible Outline integration point: ${relative}: ${before.slice(0, 80)}`,
      );
    plan.set(relative, source.replaceAll(before, after));
  }
  for (const relative of manifest.additions) {
    if (fs.existsSync(safe(build, relative)))
      throw new Error(`New print module already exists: ${relative}`);
    plan.set(
      relative,
      fs.readFileSync(safe(packet, "additions/" + relative), "utf8"),
    );
  }
  const assetDir = path.join(build, "app/assets");
  const assets = new Map(
    fs
      .readdirSync(assetDir)
      .filter((n) => n.endsWith(".js"))
      .map((n) => [n, fs.readFileSync(path.join(assetDir, n), "utf8")]),
  );
  const frontend = planFrontend(
    assets,
    fs.readFileSync(path.join(packet, "widget.js"), "utf8"),
    manifest.id.slice(0, 16),
  );
  for (const [relative, source] of frontend.files) {
    if (fs.existsSync(safe(build, relative)))
      throw new Error(`Frontend patch file collision: ${relative}`);
    plan.set(relative, source);
  }
  for (const relative of [
    "app/.vite/manifest.json",
    "app/index.html",
    "app/sw.js",
  ]) {
    const original = fs.readFileSync(safe(build, relative), "utf8");
    const updated = frontend.rewrite(original);
    if (updated !== original) plan.set(relative, updated);
  }
  for (const [relative, source] of plan)
    if (relative.endsWith(".js") || relative.endsWith(".cjs"))
      parse(source, {
        ecmaVersion: "latest",
        sourceType: relative.startsWith("app/") ? "module" : "script",
        allowReturnOutsideFunction: true,
      });
  const outlineVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const report = {
    status: dryRun ? "compatible" : "applied",
    id: manifest.id,
    outlineVersion,
    serverIntegrationFiles: new Set(serverRules.map((r) => r[0])).size,
    newModules: manifest.additions.length,
    frontendEntryPoints: frontend.semanticAssets,
    cacheBustedAssets: frontend.renamed.size,
  };
  if (dryRun) return report;
  const state = {
    id: manifest.id,
    pid: process.pid,
    status: "applying",
    outlineVersion,
    files: [...plan].map(([relative, source]) => {
      const file = safe(build, relative),
        original = fs.existsSync(file) ? fs.readFileSync(file) : null;
      return {
        path: "build/" + relative,
        before: original ? hash(original) : null,
        after: hash(source),
        original: original?.toString("base64") ?? null,
      };
    }),
  };
  atomic(stateFile, JSON.stringify(state));
  try {
    for (const [relative, source] of plan)
      atomic(safe(build, relative), source);
    state.status = "complete";
    atomic(stateFile, JSON.stringify(state));
  } catch (error) {
    restore(root, state);
    fs.rmSync(stateFile);
    throw error;
  }
  return report;
}

if (process.argv[1]?.endsWith("apply.cjs")) {
  try {
    console.log(
      JSON.stringify(
        applyPatch(
          process.argv[2] ?? "/opt/outline",
          path.dirname(process.argv[1]),
          { dryRun: process.argv.includes("--check") },
        ),
      ),
    );
  } catch (error) {
    console.error("Outline print patch refused:", error.message);
    process.exitCode = 1;
  }
}
