import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderRelease } from "./render-release.js";

const patcher = await readFile("deploy/compose.print.yaml", "utf8");
const outline = await readFile("deploy/compose.outline.yaml", "utf8");
const versions = JSON.parse(await readFile("versions.json", "utf8"));
const release = {
  version: versions.outline.tag.replace(/^v/, ""),
  image: versions.distribution.image,
  digests: {
    outline: `sha256:${"1".repeat(64)}`,
    patcher: `sha256:${"2".repeat(64)}`,
  },
};

test("patcher release pins the offline publisher and uses a fresh directory per build", async () => {
  const result = renderRelease(patcher, release, "patcher");
  assert.equal(
    JSON.parse(await readFile("package.json", "utf8")).version,
    release.version,
  );
  assert.ok(
    result.includes(
      `${release.image}:patcher-${release.version}@${release.digests.patcher}`,
    ),
  );
  const mount = `./data/outline-print/patches/${release.version}-${"2".repeat(12)}`;
  assert.equal(result.split(mount).length, 3);
  assert.ok(result.includes(`${mount}:/opt/outline-pdf:ro`));
  assert.ok(result.includes(`${mount}:/patches`));
  assert.match(result, /service_completed_successfully/);
  assert.match(result, /network_mode: none/);
  assert.doesNotMatch(result, /TOKEN|healthcheck|ports:|build:/);
  const rebuilt = renderRelease(
    patcher,
    {
      ...release,
      digests: { ...release.digests, patcher: `sha256:${"4".repeat(64)}` },
    },
    "patcher",
  );
  assert.ok(!rebuilt.includes(mount));
});

test("Outline release replaces only the application image and enables printing", () => {
  const result = renderRelease(outline, release, "outline");
  assert.ok(
    result.includes(
      `${release.image}:outline-${release.version}@${release.digests.outline}`,
    ),
  );
  assert.match(result, /ADVANCED_PRINT_ENABLED: "true"/);
  assert.doesNotMatch(
    result,
    /entrypoint:|command:|depends_on:|volumes:|outline-print:|build:/,
  );
});

test("release generation refuses version mismatches, invalid digests and template drift", () => {
  assert.throws(
    () => renderRelease(patcher, { ...release, version: "99.0.0" }, "patcher"),
    /match Outline/,
  );
  for (const deployment of ["outline", "patcher"] as const) {
    assert.throws(
      () =>
        renderRelease(
          patcher,
          {
            ...release,
            digests: { ...release.digests, [deployment]: "" },
          },
          "patcher",
        ),
      new RegExp(`${deployment} image digest`),
    );
    const template = deployment === "outline" ? outline : patcher;
    assert.throws(
      () =>
        renderRelease(
          template.replace(
            `${release.image}:${deployment}-${release.version}`,
            `${release.image}:latest`,
          ),
          release,
          deployment,
        ),
      new RegExp(`${deployment} image`),
    );
  }
  assert.throws(
    () =>
      renderRelease(
        patcher.replace(
          `./data/outline-print/patches/${release.version}`,
          "./wrong-directory",
        ),
        release,
        "patcher",
      ),
    /two mounts/,
  );
});

test("release CLI produces both Compose overrides, image metadata and deployment notes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "outline-pdf-release-"));
  try {
    const digestFile = path.join(directory, "digests.json");
    await writeFile(digestFile, JSON.stringify(release.digests));
    execFileSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/render-release.ts",
      release.version,
      release.image,
      digestFile,
      directory,
    ]);
    const images = JSON.parse(
      await readFile(path.join(directory, "images.json"), "utf8"),
    );
    assert.deepEqual(images.platforms, versions.distribution.platforms);
    for (const [deployment, filename] of [
      ["outline", "compose.outline.yaml"],
      ["patcher", "compose.print.yaml"],
    ] as const) {
      const reference = `${release.image}:${deployment}-${release.version}@${release.digests[deployment]}`;
      assert.equal(images.images[deployment], reference);
      assert.ok(
        (await readFile(path.join(directory, filename), "utf8")).includes(
          reference,
        ),
      );
    }
    const notes = await readFile(
      path.join(directory, "release-notes.md"),
      "utf8",
    );
    assert.match(notes, /Prepatched Outline/);
    assert.match(notes, /Startup patcher/);
    assert.doesNotMatch(notes, /\{\{/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
