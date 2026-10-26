# syntax=docker/dockerfile:1.7
FROM node@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY integration ./integration
COPY runtime ./runtime
COPY scripts/build-patch.mjs ./scripts/build-patch.mjs
RUN node scripts/build-patch.mjs /app/patch-package
RUN node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()) walk(file);
    else if (/^(licen[sc]e|notice)/i.test(entry.name)) {
      const target=path.join('/app/licenses',file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(file,target);
    }
  }
}
walk('node_modules');
JS

FROM node@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS patcher
WORKDIR /app
COPY package.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/licenses ./licenses
COPY --from=build /app/patch-package ./patch-package
COPY runtime/publish-patch.mjs ./publish-patch.mjs
COPY runtime/start-patch.mjs /usr/local/bin/start-patch.mjs
RUN mkdir /patches
USER root
LABEL org.opencontainers.image.source="https://github.com/YiPrograms/outline-pdf"
ENTRYPOINT ["node", "/usr/local/bin/start-patch.mjs"]

# Keep the official runtime user, entrypoint, command and healthcheck.
FROM docker.getoutline.com/outlinewiki/outline@sha256:25d6a2ced2f1f0cf03c09abd776d87ba31941ed96d3a99992aa84b3bd0afc074 AS outline
COPY --from=build --chown=nodejs:nodejs /app/patch-package /tmp/outline-pdf
COPY --from=build /app/licenses /opt/outline-pdf-notices/licenses
COPY LICENSE THIRD_PARTY_NOTICES.md /opt/outline-pdf-notices/
RUN node /tmp/outline-pdf/apply.cjs /opt/outline && rm -rf /tmp/outline-pdf
LABEL org.opencontainers.image.source="https://github.com/YiPrograms/outline-pdf"
LABEL org.opencontainers.image.title="Outline PDF Print"
