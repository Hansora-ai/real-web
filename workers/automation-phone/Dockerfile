FROM node:22.22.0-bookworm-slim
# The LiveKit connection library verifies TLS with the system certificates,
# which the slim image does not include.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/automation-phone/package*.json ./workers/automation-phone/
RUN npm ci --prefix workers/automation-phone --omit=dev
COPY lib ./lib
COPY workers/automation-phone/src ./workers/automation-phone/src
CMD ["node", "workers/automation-phone/src/worker.mjs", "start"]
