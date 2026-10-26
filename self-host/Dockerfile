# Realty Funnel Desk — server version with sign-in. Data (accounts, shared data, uploaded files) lives in /data:
# mount a persistent volume there, or everything is lost when the container is replaced.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages python-pptx \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 COOKIE_SECURE=1
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]
