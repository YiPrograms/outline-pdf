import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const [output = "build/patch-package"] = process.argv.slice(2);
await fs.mkdir(output, { recursive: true });
const additions = [];
async function collect(directory, relative = "server") {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, item.name);
    if (item.isDirectory())
      await collect(path.join(directory, item.name), name);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      const target = name.slice(0, -3) + ".js";
      await fs.mkdir(path.join(output, "additions", path.dirname(target)), {
        recursive: true,
      });
      await build({
        stdin: {
          contents: await fs.readFile(path.join(directory, item.name), "utf8"),
          resolveDir: path.resolve(directory),
          // Match the default-export interop of Outline's compiled CommonJS modules.
          sourcefile: item.name.replace(/\.ts$/, ".cts"),
          loader: "ts",
        },
        outfile: path.join(output, "additions", target),
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        plugins: [
          {
            name: "outline-imports",
            setup(builder) {
              builder.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind === "entry-point") return;
                let dependency = args.path;
                if (/^@(server|shared)\//.test(dependency)) {
                  dependency = path.posix.relative(
                    path.posix.dirname(target),
                    dependency.slice(1),
                  );
                  if (!dependency.startsWith("."))
                    dependency = "./" + dependency;
                }
                return { path: dependency, external: true };
              });
            },
          },
        ],
      });
      additions.push(target);
    }
  }
}
await collect("integration/outline/server");
await build({
  entryPoints: ["integration/runtime/apply.mjs"],
  outfile: path.join(output, "apply.cjs"),
  platform: "node",
  format: "cjs",
  target: "node20",
  bundle: true,
});
await fs.copyFile(
  "integration/runtime/entrypoint.sh",
  path.join(output, "entrypoint.sh"),
);
const component = await fs.readFile(
  "integration/outline/app/components/AdvancedPrintDialog.tsx",
  "utf8",
);
const source =
  'export {AdvancedPrintView} from "./AdvancedPrintView";\nimport {React,styled,Button} from "./outline-pdf-bridge.js";\nimport {usePrintTranslation} from "../utils/printI18n";\nexport {React,env,Button} from "./outline-pdf-bridge.js";\nconst {useState}=React;\n' +
  component.slice(component.indexOf("interface Props"));
await build({
  stdin: {
    contents: source,
    resolveDir: path.resolve("integration/outline/app/components"),
    loader: "tsx",
  },
  outfile: path.join(output, "widget.js"),
  bundle: true,
  external: ["./outline-pdf-bridge.js"],
  loader: { ".css": "text" },
  plugins: [
    {
      name: "native-i18n",
      setup(builder) {
        builder.onResolve({ filter: /^react-i18next$/ }, () => ({
          path: "./outline-pdf-bridge.js",
          external: true,
        }));
      },
    },
  ],
  format: "esm",
  target: "es2020",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
});
const files = {};
async function digests(directory, prefix = "") {
  for (const entry of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      await digests(path.join(directory, entry.name), relative);
    else if (relative !== "manifest.json")
      files[relative] = createHash("sha256")
        .update(await fs.readFile(path.join(directory, entry.name)))
        .digest("hex");
  }
}
await digests(output);
const id = createHash("sha256")
  .update(
    Object.entries(files)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([n, h]) => n + ":" + h + "\n")
      .join(""),
  )
  .digest("hex");
await fs.writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify({ id, files, additions: additions.sort() }, null, 2) + "\n",
);
console.log(`Built patch-only package ${id} (${additions.length} print files)`);
