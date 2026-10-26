# Outline PDF Print

Print Outline documents and collections from one page, with linked tables of contents and links between documents. Adjust paper size, scale, and margins in your browser, then print or save as PDF.

- Single documents, document trees, and collections.
- Outline’s native rendering in a light theme.
- Optional tables of contents and comments.

Supports **Outline 1.12.0** on **Linux x86-64**, with Docker Compose v2 and an existing Outline deployment.

## Deployment

Choose one method:

| Method                 | Image                                           | Setup                                                           |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| **Prepatched Outline** | `ghcr.io/yiprograms/outline-pdf:outline-1.12.0` | Replace the Outline image.                                      |
| **Startup patcher**    | `ghcr.io/yiprograms/outline-pdf:patcher-1.12.0` | Keep the official Outline image and apply the patch at startup. |

### Prepatched Outline

Update the `outline` service in your Compose file:

```yaml
services:
  outline:
    image: ghcr.io/yiprograms/outline-pdf:outline-1.12.0
    environment:
      ADVANCED_PRINT_ENABLED: "true"
```

Keep your existing environment, storage, and other services, then run:

```sh
docker compose pull outline
docker compose up -d outline
```

### Startup patcher

Download the Compose override into your deployment directory:

```sh
curl -fL https://github.com/YiPrograms/outline-pdf/releases/download/v1.12.0/compose.print.yaml -o compose.print.yaml
docker compose -f compose.yaml -f compose.print.yaml up -d
docker compose -f compose.yaml -f compose.print.yaml ps -a
```

Outline should be running and `outline-print` should show **Exited (0)**. This method requires write access to Outline’s application directory during startup.

The override assumes your service is named `outline`. Replace `compose.yaml` with your existing filename and use the same `-f` arguments for subsequent commands.

[Release downloads](https://github.com/YiPrograms/outline-pdf/releases/latest) include digest-pinned overrides for both methods: `compose.outline.yaml` and `compose.print.yaml`. Use only one override.

## Usage

Open **Document options → Export → Print to PDF…**, or the equivalent export menu for a collection.

Choose the scope and options, then select **Open print view → Print to PDF**. Set the paper size, scale, margins, and destination in your browser’s print dialog.

For page numbers, use a current Chromium-based browser and choose their position in the print view. Numbered tables of contents include paper and margin controls in the preview; print with the same paper, no browser margins, and 100% scale.

Printing follows Outline’s download permissions. Embedded content depends on the browser and the source service; check the preview before printing.

## Operations

```sh
docker compose ps
docker compose logs --tail 100 outline
docker compose restart outline
```

For the patcher method, include both Compose files and inspect `outline-print` logs if startup fails.

See the [deployment guide](docs/deployment.md) for configuration, upgrades, removal, and troubleshooting.

## Documentation

- [Deployment](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Publishing](docs/publishing.md)

## License

[MIT](LICENSE) covers this project’s code. The prepatched image includes Outline under its upstream license. See [third-party notices](THIRD_PARTY_NOTICES.md).
