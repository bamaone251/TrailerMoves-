FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3030
ENV TZ=America/Chicago
EXPOSE 3030
VOLUME ["/app/data", "/app/archives"]
CMD ["npm", "start"]
