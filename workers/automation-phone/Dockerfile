FROM node:22.22.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/automation-phone/package*.json ./workers/automation-phone/
RUN npm ci --prefix workers/automation-phone --omit=dev
COPY lib ./lib
COPY workers/automation-phone/src ./workers/automation-phone/src
COPY workers/automation-phone/test ./workers/automation-phone/test
RUN npm test --prefix workers/automation-phone
ENV GEMINI_PHONE_MODEL=gemini-3.8-live
ENV GEMINI_PHONE_VOICE=Leda
RUN chown -R node:node /app
USER node
CMD ["node", "workers/automation-phone/src/worker.mjs", "start"]
