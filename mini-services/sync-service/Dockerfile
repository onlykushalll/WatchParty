FROM oven/bun:latest

WORKDIR /app

COPY package*.json ./
RUN bun install

COPY . .

EXPOSE 3003

ENV PORT=3003
ENV CORS_ORIGIN=*

CMD ["bun", "run", "index.ts"]
