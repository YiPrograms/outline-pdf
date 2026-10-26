# Third-party software

The [MIT license](LICENSE) covers this project's code. Bundled applications and dependencies retain their own licenses.

- **Outline** is under its [Business Source License](https://github.com/outline/outline/blob/09f11188b87b0220fa318dfa6fdd0fa9772195dd/LICENSE). The `outline-*` image derives from the official image and includes its application build and upstream license files. The `patcher-*` image does not include Outline's application build.
- **Paged.js** provides optional browser pagination under the MIT license.
- **Acorn** is bundled into the patch installer under the MIT license.
- Dependency license and notice files are included under `/app/licenses` in the patcher image and `/opt/outline-pdf-notices/licenses` in the prepatched Outline image.
- Document rendering uses Outline’s existing web editor and its dependencies, which retain their upstream licenses.
- The patcher includes this file and the project's license under `/app`. The prepatched image includes them under `/opt/outline-pdf-notices` and preserves Outline's own license. Both base images retain their upstream software notices.
