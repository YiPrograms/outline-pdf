# Outline PDF Print {{version}}

Print documents, document trees, and collections using Outline’s native rendering. Includes linked tables of contents, optional comments, and a light print view. Paper size, margins, and PDF output are controlled by your browser.

Supports **Outline {{version}} on Linux x86-64**.

Choose one deployment method:

| Method                 | Image                           | Compose override                                                                                                      |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Prepatched Outline** | `{{image}}:outline-{{version}}` | [compose.outline.yaml](https://github.com/YiPrograms/outline-pdf/releases/download/v{{version}}/compose.outline.yaml) |
| **Startup patcher**    | `{{image}}:patcher-{{version}}` | [compose.print.yaml](https://github.com/YiPrograms/outline-pdf/releases/download/v{{version}}/compose.print.yaml)     |

The prepatched image replaces your Outline application image. The patcher keeps the official Outline image and applies the patch at startup; its application directory must be writable.

Download the chosen override into your existing deployment directory:

```sh
# Prepatched Outline
docker compose -f compose.yaml -f compose.outline.yaml up -d

# Or: startup patcher
docker compose -f compose.yaml -f compose.print.yaml up -d
```

Replace `compose.yaml` with your existing filename. The overrides assume the application service is named `outline` and pin image digests.

See the [README](https://github.com/YiPrograms/outline-pdf/blob/v{{version}}/README.md) and [deployment guide](https://github.com/YiPrograms/outline-pdf/blob/v{{version}}/docs/deployment.md).
