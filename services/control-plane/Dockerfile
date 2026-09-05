# Build stage: install deps and compile NestJS
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json nest-cli.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx nest build

# Runtime stage: production deps + dist only
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN addgroup -g 10002 cp && adduser -D -u 10002 -G cp cp
USER cp
EXPOSE 8081
CMD ["node", "dist/main.js"]