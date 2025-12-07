FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Сборка фронтенда и подготовка прод-зависимостей
RUN npm run build && npm prune --omit=dev

FROM node:18-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Копируем только нужное
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package*.json ./
EXPOSE 3000
CMD ["node", "server/index.js"]

