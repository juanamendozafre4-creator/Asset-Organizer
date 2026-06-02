FROM node:24-slim
WORKDIR /app
COPY artifacts/api-server/dist/ ./dist/
ENV PORT=10000
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
