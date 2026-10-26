import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const versions = JSON.parse(
  await readFile(new URL("../versions.json", import.meta.url), "utf8"),
);
const outlineVersion = versions.outline.tag.replace(/^v/, "");
type Deployment = "outline" | "patcher";
interface Release {
  version: string;
  image: string;
  digests: Record<Deployment, string>;
}

/** Pins either deployment image; patcher builds also get a fresh directory. */
export function renderRelease(
  template: string,
  release: Release,
  deployment: Deployment,
): string {
  if (release.version !== outlineVersion)
    throw new Error(`Release version must match Outline ${outlineVersion}`);
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*$/.test(release.image))
    throw new Error("Use a lowercase GHCR repository name without a tag");
  for (const kind of ["outline", "patcher"] as const)
    if (!/^sha256:[0-9a-f]{64}$/.test(release.digests[kind] ?? ""))
      throw new Error(`Missing or invalid ${kind} image digest`);
  const original = `${versions.distribution.image}:${deployment}-${outlineVersion}`;
  if (template.split(original).length !== 2)
    throw new Error(`Expected one ${deployment} image in Compose template`);
  const pinned = template.replace(
    original,
    `${release.image}:${deployment}-${release.version}@${release.digests[deployment]}`,
  );
  if (deployment === "outline") return pinned;
  const patchPath = `./data/outline-print/patches/${outlineVersion}`;
  if (template.split(patchPath).length !== 3)
    throw new Error("Expected two mounts of the versioned patch directory");
  return pinned.replaceAll(
    patchPath,
    `${patchPath}-${release.digests.patcher.slice(7, 19)}`,
  );
}

async function main() {
  const [version, image, digestFile, outputDirectory] = process.argv.slice(2);
  if (!version || !image || !digestFile || !outputDirectory)
    throw new Error(
      "Usage: tsx scripts/render-release.ts VERSION IMAGE DIGEST_JSON OUTPUT_DIR",
    );
  const release: Release = {
    version,
    image,
    digests: JSON.parse(await readFile(digestFile, "utf8")),
  };
  await mkdir(outputDirectory, { recursive: true });
  for (const [deployment, filename] of [
    ["outline", "compose.outline.yaml"],
    ["patcher", "compose.print.yaml"],
  ] as const) {
    const compose = renderRelease(
      await readFile(path.join("deploy", filename), "utf8"),
      release,
      deployment,
    );
    await writeFile(path.join(outputDirectory, filename), compose);
  }
  await writeFile(
    path.join(outputDirectory, "images.json"),
    JSON.stringify(
      {
        version,
        testedOutline: versions.outline.tag,
        platforms: versions.distribution.platforms,
        images: {
          outline: `${image}:outline-${version}@${release.digests.outline}`,
          patcher: `${image}:patcher-${version}@${release.digests.patcher}`,
        },
      },
      null,
      2,
    ) + "\n",
  );
  const notes = (await readFile("docs/release-notes.md", "utf8"))
    .replaceAll("{{version}}", version)
    .replaceAll("{{image}}", image);
  await writeFile(path.join(outputDirectory, "release-notes.md"), notes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
