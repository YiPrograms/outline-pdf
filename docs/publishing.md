# Releases

Release versions match the supported Outline version in `versions.json`, `package.json`, `package-lock.json`, and the Compose files under `deploy/`. Each release builds and publishes **two images** from the same patch sources:

| Image                                           | Purpose                                                              | Build target |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| `ghcr.io/yiprograms/outline-pdf:outline-1.12.0` | Complete Outline application, patched at build time                  | `outline`    |
| `ghcr.io/yiprograms/outline-pdf:patcher-1.12.0` | Offline, one-shot patch publisher for an official Outline deployment | `patcher`    |

## Build and validation

```sh
docker compose -f deploy/compose.build.yaml build
npm test
npm run typecheck
npm run format:check
PRINT_TEST_SKIP_BUILD=true npm run test:integration
```

The integration suite starts each deployment from a source-free directory and runs API, authorization, browser, PDF, and rollback checks for both. It additionally checks publisher/recovery behavior for the patcher method and inherited startup configuration and installed patch integrity for the prepatched image.

The official Outline digest in `deploy/patch.Dockerfile` and `deploy/compose.test.yaml` must match `versions.json`. Preserve upstream license files in the derived image and bundled dependency notices in both distributions.

## Publishing

Create a GitHub release such as `v1.12.0` to run **Publish images and Compose release**. The workflow tests both images before pushing either, records both digests, verifies anonymous access to both tags, and attaches:

- `compose.outline.yaml`: digest-pinned prepatched Outline deployment.
- `compose.print.yaml`: digest-pinned startup patcher deployment, with a distinct patch directory per build.
- `images.json`: both image references, tested Outline version, and supported platform.
- `digests.json`: the `outline` and `patcher` image digests.
- `release-notes.md`: instructions for the two deployment methods.

`docs/release-notes.md` is the release description template. The renderer substitutes the version and image repository. Use the generated `release-notes.md` as the release description; the workflow attaches it without replacing any hand-written release body.

The GHCR package must be public. The workflow requires `contents: write` and `packages: write`. Manual workflow runs publish the same two image tags and create the same bundle as an artifact without attaching it to a release.

Confirm CI, both integration runs, and anonymous image access before announcing an update. Keep the bundled dependency license notices; see [third-party notices](../THIRD_PARTY_NOTICES.md).
