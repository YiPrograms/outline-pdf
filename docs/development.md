# Development and testing

Use Linux x86-64, Node.js 22 or later, Docker Compose v2, Chromium, and Poppler (`pdftotext`).

```sh
git clone https://github.com/YiPrograms/outline-pdf.git
cd outline-pdf
npm ci
node_modules/.bin/playwright-core install --with-deps chromium
npm test
npm run typecheck
npm run format:check
npm run test:integration
```

Use an installed `/usr/bin/chromium` or set `CHROMIUM_PATH` on distributions unsupported by the Playwright browser installer.

The integration suite builds and tests both distribution images:

- `outline-1.12.0`: prepatched official Outline, retaining its runtime user, entrypoint, command, and healthcheck. Checks verify the patch is already in the image and the running service needs no patch mount.
- `patcher-1.12.0`: offline installer plus the official Outline image and startup hook. Checks cover publisher permissions, idempotency, integrity checks, and interrupted-install recovery.

Each method starts an isolated Outline stack from a source-free deployment directory, then checks authorization, linked print views, browser rendering, native print invocation, customizable PDF printing, and rollback to the official image. Browser-generated PDFs are test artifacts only. Evidence is saved under `tmp/integration-check.*/` and `output/print/`.

Tests remove their containers and volumes. `PRINT_TEST_SKIP_BUILD=true` reuses local images; `PRINT_TEST_RETAIN_ON_FAILURE=true` retains a failed test stack for diagnosis. To run only one method:

```sh
sh scripts/test-integration.sh outline
sh scripts/test-integration.sh patcher
```

## Building images

Both targets share the package-building stage in `deploy/patch.Dockerfile`:

```sh
docker compose -f deploy/compose.build.yaml build
```

To build only one, append the service name `outline` or `outline-print`. The prepatched target applies the patch during the image build and fails if integration points are incompatible. The patcher target publishes the same package at runtime. See the [release guide](publishing.md) for publishing and metadata.

## Layout

- `src/`: native-render readiness, document composition, anchors, and print layout.
- `integration/`: Outline API, UI, translations, and transactional installer.
- `runtime/`: patch publication and installer startup.
- `deploy/`: alternative deployment overrides, maintainer build Compose, test stack, and shared multi-stage Dockerfile.
- `scripts/` and `fixtures/`: tests and release tooling.
