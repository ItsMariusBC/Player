FROM node:24.6.0-alpine@sha256:51dbfc749ec3018c7d4bf8b9ee65299ff9a908e38918ce163b0acfcd5dd931d9 AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive
COPY . .
RUN yarn build

FROM node:24.6.0-alpine@sha256:51dbfc749ec3018c7d4bf8b9ee65299ff9a908e38918ce163b0acfcd5dd931d9 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive --production \
  && yarn cache clean
COPY --from=build /app/dist ./dist
# hadolint ignore=DL3018
RUN apk add --no-cache ffmpeg
RUN addgroup -g 101 player \
  && adduser -D -u 101 -G player player \
  && mkdir -p /data \
  && chown 101:101 /data
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=70s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server/main.js"]
