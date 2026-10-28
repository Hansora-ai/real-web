FROM node:22.22.0-bookworm-slim
WORKDIR /app
COPY workers/automation-phone/package*.json ./workers/automation-phone/
RUN npm ci --prefix workers/automation-phone --omit=dev
COPY lib ./lib
COPY workers/automation-phone/src ./workers/automation-phone/src
CMD ["node", "workers/automation-phone/src/worker.mjs", "start"]
