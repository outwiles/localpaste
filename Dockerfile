# Outwiles LocalPaste has zero npm dependencies, so this image is
# deliberately simple: copy the source, run it with plain Node.js.
FROM node:20-alpine

WORKDIR /app

# There is nothing to install (no dependencies), but this keeps the image
# build cache-friendly if that ever changes.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true

COPY server ./server
COPY public ./public

# Run as a non-root user inside the container.
RUN addgroup -S localpaste && adduser -S localpaste -G localpaste \
  && mkdir -p /app/data \
  && chown -R localpaste:localpaste /app
USER localpaste

ENV PORT=8420 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

EXPOSE 8420

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8420) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
