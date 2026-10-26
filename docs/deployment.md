# Deployment

Start with the [deployment instructions](../README.md#deployment) and an existing Outline deployment. Releases provide two mutually exclusive methods for Outline 1.12.0 on Linux x86-64:

| Method                                   | Image                                           | Release file           |
| ---------------------------------------- | ----------------------------------------------- | ---------------------- |
| A: prepatched Outline                    | `ghcr.io/yiprograms/outline-pdf:outline-1.12.0` | `compose.outline.yaml` |
| B: startup patcher with official Outline | `ghcr.io/yiprograms/outline-pdf:patcher-1.12.0` | `compose.print.yaml`   |

Both release overrides pin image digests. Use one method per deployment.

## Method A: prepatched Outline

The image includes Outline with PDF printing enabled by the configuration below.

Use `compose.outline.yaml` with your existing Compose file, or change the application image and enable printing directly:

```yaml
services:
  outline:
    image: ghcr.io/yiprograms/outline-pdf:outline-1.12.0
    environment:
      ADVANCED_PRINT_ENABLED: "true"
```

Keep your existing database, Redis, file storage, networks, environment settings, and startup command. To pin the image digest, use the release’s `compose.outline.yaml` override.

## Method B: startup patcher

Use `compose.print.yaml` to keep the official Outline image. Change the `outline` service key to match your application service. Keep your existing image, data volumes, networks, and environment settings. If you use a custom startup command, preserve it in the override's `command` field.

Mount both patch paths exactly as supplied in the release file. Outline mounts the patch package read-only at `/opt/outline-pdf`; the installer writes the same host directory through `/patches`. The offline `outline-print` service publishes the package and exits successfully before Outline starts.

Run the installer before every Outline service that serves web requests. The installer needs write access to the patch directory; Outline needs write access to its own application files during startup. A read-only application filesystem is unsupported for this method.

## Configuration

All print settings are optional beyond the enabled flag supplied by either Compose override. Set these on the Outline service:

| Variable                       | Default    | Purpose                                                 |
| ------------------------------ | ---------- | ------------------------------------------------------- |
| `ADVANCED_PRINT_ENABLED`       | `false`    | Enables the print entry points and endpoint.            |
| `ADVANCED_PRINT_MAX_DOCUMENTS` | `200`      | Maximum documents per print view; up to 1,000.          |
| `ADVANCED_PRINT_MAX_SIZE`      | `52428800` | Maximum document snapshot size in bytes; up to 256 MiB. |
| `ADVANCED_PRINT_TIMEOUT`       | `180000`   | Preparation time limit in milliseconds; up to 600,000.  |

Print views use the current Outline session and download permissions. Inaccessible branches are excluded. Content and assets render through Outline’s native editor.

## Upgrades and rollback

Keep a copy of your Compose files and current image references before upgrading. For method B, also keep the patch directory. Check the supported Outline version before upgrading Outline itself.

### Method A

Download the new `compose.outline.yaml`, then pull and recreate the application:

```sh
docker compose -f compose.yaml -f compose.outline.yaml pull outline
docker compose -f compose.yaml -f compose.outline.yaml up -d --force-recreate outline
```

Restore the previous override and recreate Outline to roll back the image. The base image includes Outline itself, so upgrades across Outline versions must also follow upstream database migration and backup requirements.

### Method B

Download the new `compose.print.yaml`, then run:

```sh
docker compose -f compose.yaml -f compose.print.yaml pull outline-print
docker compose -f compose.yaml -f compose.print.yaml up -d --force-recreate outline-print outline
```

Use both patch mounts from the new file. Each release build uses a distinct patch directory. Recreate Outline from its official image rather than applying a new patch over an already patched container. To roll back, restore the previous override and recreate both services.

## Switching methods

Use an image based on the same Outline version when switching packaging methods. Keep your database and data volumes.

- **B to A:** remove `compose.print.yaml` from your Compose command. If its settings were merged into the base file, remove the `outline-print` service, patch mount, installer dependency, and entrypoint override, and restore the official command or your custom command. Start with `compose.outline.yaml` and recreate Outline. Remove the stopped installer container with `--remove-orphans` only if the project has no other intentionally retained orphan services.
- **A to B:** remove `compose.outline.yaml` from your Compose command. If its image was merged into the base file, restore the supported official Outline image. Start with `compose.print.yaml` and recreate `outline-print` and `outline`.

Do not stack both overrides. Method B must start from an unpatched official image.

## Removal

If your base Compose file still uses the official image and has no merged print settings, remove the chosen override and recreate Outline:

```sh
docker compose -f compose.yaml up -d --force-recreate outline
```

If settings were merged into the base file, restore the official Outline image and remove print environment settings. For method B, also remove the installer service, patch mount, and installer dependency, and restore the original entrypoint and command.

Do not use `down -v` on your deployment: it deletes data volumes.

## Troubleshooting

| Symptom                                           | Check                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Method A attempts to run a patch installer        | Remove leftover method B entrypoint, mount, and dependency settings.                                          |
| Method B reports an existing or different patch   | Restore the official Outline image and recreate the container; do not use the prepatched image with method B. |
| Installer shows Exited (0)                        | Normal for method B: patch publication has completed. Method A has no installer.                              |
| Installer exits with an error                     | Check directory permissions and `outline-print` logs.                                                         |
| Patch package mismatch                            | Use the patch directory from the new release file and recreate both services.                                 |
| Outline reports an incompatible integration point | Check the supported Outline version for method B.                                                             |
| No print tab opens                                | Allow pop-ups for your Outline site.                                                                          |
| Print action is missing                           | Check `ADVANCED_PRINT_ENABLED` and refresh the page after recreating Outline.                                 |
| Some content cannot be rendered                   | Check the affected image or diagram; the remaining page can still be printed.                                 |
| Large views fail                                  | Try a smaller scope or review the preparation limits and Outline logs.                                        |
