# FaceItTrackIt (SPA + BFF + SQLite)

## Описание
Веб‑приложение для поиска игроков FaceIT, просмотра профилей и истории матчей, аналитики карт/тиммейтов, а также управления пользовательскими сущностями: избранное, заметки, цели. Клиент — Angular 18 + Taiga UI. Сервер — Node.js/Express с локальным SQLite, проксирование FaceIT API с ротацией ключей и JWT (httpOnly cookie).

## Возможности
- Поиск игроков по нику/ID, краткая и детальная статистика (ELO/уровень, K/D, Win Rate, матчи, HS%).
- История матчей, счёт по раундам (когда доступно), аналитика карт и тиммейтов.
- Избранное: добавление/удаление игроков.
- Заметки: по матчам/игрокам/тиммейтам.
- Цели: winrate/kd/matches с прогрессом.
- Аутентификация: регистрация/логин, JWT в httpOnly cookie.
- Ротация FaceIT API ключей и ретраи при rate limit (429/403/401).

## Стек
- Frontend: Angular 18, Taiga UI, ZingChart.
- Backend (BFF): Node.js, Express, better-sqlite3, bcryptjs, jsonwebtoken, cookie-parser, dotenv.
- DB: SQLite (файл `server/data.db` по умолчанию).
- Тесты: Jest + supertest (сервер), Nx/Jest (клиент).
- CI: GitHub Actions.
- Docker: multi-stage build.

## Требования
- Node.js 18+
- npm
- FaceIT API ключи
- (Опционально) Docker

## Установка
```bash
npm install
```

## Запуск (dev)
Сервер:
```bash
npm run server
```
Фронт:
```bash
npm start
```
Фронт: http://localhost:4200, сервер: http://127.0.0.1:3000.

## Тесты
- Сервер:
```bash
npm run test:server
```
- Клиент:
```bash
npm test
```

## Сборка
```bash
npm run build
```
Собранный фронт: `dist/finance-tracker/`.

## Docker
```bash
docker build -t faceittrackit .
docker run -p 3000:3000 --env-file server/.env faceittrackit
```

## Структура
- `server/index.js` — Express, маршруты `/api/auth`, `/api/profile`, `/api/favorites`, `/api/notes`, `/api/goals`, `/api/faceit/*`, ротация ключей, создание таблиц SQLite, статика фронта.
- `server/index.test.js` — Jest + supertest.
- `src/app/services/*` — клиентские сервисы auth/profile/favorites/notes/goals/faceit.
- `proxy.conf.json` — прокси дев-сервера Angular на BFF.
- `.github/workflows/ci.yml` — CI pipeline (install, test:server, test, build).

## Ограничения FaceIT API
- Новые матчи: обычно доступен счёт по раундам.
- Старые матчи: может быть только итоговый результат (1-0 / 0-1).
