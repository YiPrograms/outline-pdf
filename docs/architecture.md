# Architecture

Both distribution images use the same patch package and print implementation. They differ in when the patch is applied and what the operator deploys.

## Method A: prepatched Outline image

`ghcr.io/yiprograms/outline-pdf:outline-1.12.0` derives from the pinned official Outline image. During the image build, the installer validates the integration points and applies the patch. An incompatible upstream build fails before an image can be released.

The resulting image inherits the official runtime user, entrypoint, command, and healthcheck. It needs no startup hook, installer service, or shared patch mount. The build removes the temporary patch package; dependency notices are included under `/opt/outline-pdf-notices`. The patch state records the installed package and file hashes.

## Method B: startup patcher image

`ghcr.io/yiprograms/outline-pdf:patcher-1.12.0` contains the patch package and its publisher, without Outline's application build. The `outline-print` container publishes the package to a shared bind mount, then exits. It runs without network access and drops root before writing the package. Official Outline mounts the package read-only, applies it at startup, and starts through its official entrypoint.

The installer validates all integration points before writing, recovers interrupted changes, and checks installed packages on restart. Recreating Outline from its official image without the hook restores its original files.

## Shared patch mechanism

The build compiles the API and frontend widget into a hash-identified package. The installer checks the package integrity, native dependencies, and the complete modification plan before writing.

Backend integration uses validated compiled-code replacement points to register the API route and public feature flag. Frontend integration parses native bundles with Acorn, patches the document PDF action and collection export dialog, and bridges the widget to Outline's existing React components and i18next instance. Affected assets and their importers receive new filenames; the installer updates the Vite manifest, HTML, and service worker references.

Atomic file writes and a journal containing originals and before/after hashes support recovery. Already installed packages are verified rather than reapplied. A different patch requires a fresh official application filesystem. Method A performs this work while building the image; method B performs it when starting Outline.

## Print views

The `/print` frontend route runs inside Outline's authenticated application. It obtains an authorized document snapshot from `/api/advancedPrint.info`, including document data, navigation order, and print settings. The backend checks download permissions before reading content, prunes inaccessible branches, bounds snapshot size, and rechecks access before returning it.

The page renders each document with Outline's native read-only Editor under a light ThemeProvider. It reuses native syntax highlighting, diagrams, math, images, and embeds without changing the user's theme preferences. Native language loading, diagram output, image decoding, and fonts complete before print preparation proceeds.

Rendered DOM is detached from the editor for print-only layout and anchor changes. The page combines documents, namespaces IDs including repeated SVG diagrams, rewrites links within the selected scope, and adds the requested tables of contents. Native styles remain in the page; the extension supplies only print layout and controls. Failed native assets remain visible and have linked warning counts.

The right settings sidebar uses Outline’s native switches and radio selector. Layout changes reuse copies of the rendered DOM; changing comments fetches a new authorized snapshot. The sidebar collapses above the preview on smaller screens. Each document can be selected independently. Reordering moves sibling branches together; unprinted ancestors remain plain grouping labels in the tree contents. Selection and order apply only to the print view.

Page labels use native CSS page-margin counters. Numbered tables of contents use Paged.js to paginate the detached DOM with the selected paper size and margins. Page labels and contents references come from that completed layout. The native editor still renders the document content.

The browser prints or saves the result as PDF; the application creates no stored PDF artifacts.
