/* Local Express server that mirrors the Firebase Functions API.
   Endpoints (all under /api):
   - GET /api/health
   - GET /api/faceit/search
   - GET /api/faceit/players/:id
   - GET /api/faceit/players/:id/matches
   - GET /api/faceit/players/:id/matches/details
   - GET /api/faceit/players/:id/teammates
   - GET /api/faceit/players/:id/maps
   - GET /api/faceit/matches/:matchId
   - Debug endpoints:
     /api/faceit/debug/match/:matchId
     /api/faceit/debug/match-quick/:matchId
     /api/faceit/debug/match-score/:matchId

   Run with:
     FACEIT_API_KEY=xxx node server/index.js
   Optional env:
     PORT (default 3000)
     FACEIT_API_URL (default https://open.faceit.com/data/v4)
     FACEIT_GAME (default cs2)
     REQUEST_TIMEOUT_MS (default 8000)
*/

/* eslint-disable @typescript-eslint/no-var-requires */
const express = require('express');
const cors = require('cors');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Load environment variables from server/.env (preferred) or project root .env
(() => {
  try {
    const dotenv = require('dotenv');
    const serverEnv = path.join(__dirname, '.env');
    dotenv.config({ path: serverEnv });
    dotenv.config(); // fallback to root .env if present
  } catch {
    // dotenv not installed or other issue — continue without crashing
  }
})();

// Use built-in fetch if available (Node 18+), otherwise fallback to node-fetch.
let fetchFn = global.fetch;
if (!fetchFn) {
  // Lazy import to avoid ESM issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  fetchFn = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const FACEIT_API =
  process.env.FACEIT_API_URL || 'https://open.faceit.com/data/v4';
const DEFAULT_GAME = process.env.FACEIT_GAME || 'cs2';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 8000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// Ротация ключей Faceit (повторяем идею с клиента)
class ApiKeyManager {
  constructor(apiKeys, rotationConfig = {}) {
    this.keys = apiKeys && apiKeys.length ? apiKeys : [];
    this.currentKeyIndex = 0;
    this.rotation = {
      enabled: rotationConfig.enabled ?? true,
      maxRetries: rotationConfig.maxRetries ?? 2,
      cooldownMs: rotationConfig.cooldownMs ?? 6000,
    };
    this.keyStats = new Map();
    this.keys.forEach((k) =>
      this.keyStats.set(k, { failures: 0, lastUsed: 0, inCooldown: false })
    );
  }

  getCurrentKey() {
    if (!this.rotation.enabled || this.keys.length === 0) {
      return this.keys[0];
    }
    const start = this.currentKeyIndex;
    do {
      const key = this.keys[this.currentKeyIndex];
      const stats = this.keyStats.get(key);
      if (!stats) return key;
      const now = Date.now();
      if (
        !stats.inCooldown ||
        now - stats.lastUsed > this.rotation.cooldownMs
      ) {
        stats.inCooldown = false;
        stats.lastUsed = now;
        return key;
      }
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
    } while (this.currentKeyIndex !== start);
    return this.keys[0];
  }

  markKeyFailed(key) {
    const stats = this.keyStats.get(key);
    if (!stats) return;
    stats.failures += 1;
    if (stats.failures >= this.rotation.maxRetries) {
      stats.inCooldown = true;
      stats.lastUsed = Date.now();
    }
  }

  markKeySuccess(key) {
    const stats = this.keyStats.get(key);
    if (stats) {
      stats.failures = 0;
      stats.inCooldown = false;
    }
  }

  getStats() {
    return this.keys.map((key) => ({
      key: `${key.slice(0, 8)}...`,
      ...(this.keyStats.get(key) || {}),
    }));
  }
}

const apiKeysEnv = (() => {
  if (process.env.FACEIT_API_KEYS) {
    try {
      const parsed = JSON.parse(process.env.FACEIT_API_KEYS);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore parse error, fallback below
    }
  }
  return [];
})();

const fallBackKey = process.env.FACEIT_API_KEY;
if (!fallBackKey && apiKeysEnv.length === 0) {
  throw new Error(
    'FACEIT_API_KEY or FACEIT_API_KEYS must be set for server to run'
  );
}

const keyManager = new ApiKeyManager(
  apiKeysEnv.length ? apiKeysEnv : [fallBackKey],
  {
    enabled: true,
    maxRetries: Number(process.env.FACEIT_MAX_RETRIES || 2),
    cooldownMs: Number(process.env.FACEIT_COOLDOWN_MS || 6000),
  }
);

// ---------- DB (SQLite) ----------
const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data.db');
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  faceit_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, player_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL,
  progress REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const insertUser = db.prepare(
  'INSERT INTO users (id, email, password_hash, display_name, faceit_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const findUserByEmail = db.prepare(
  'SELECT * FROM users WHERE email = ? LIMIT 1'
);
const findUserById = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
const updateUserProfileStmt = db.prepare(
  'UPDATE users SET display_name = ?, faceit_id = ? WHERE id = ?'
);

const insertFavorite = db.prepare(
  'INSERT INTO favorites (id, user_id, player_id, created_at) VALUES (?, ?, ?, ?)'
);
const deleteFavorite = db.prepare(
  'DELETE FROM favorites WHERE user_id = ? AND player_id = ?'
);
const listFavorites = db.prepare(
  'SELECT player_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
);

const insertNoteStmt = db.prepare(
  'INSERT INTO notes (id, user_id, target_id, type, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const updateNoteStmt = db.prepare(
  'UPDATE notes SET text = ? WHERE id = ? AND user_id = ?'
);
const deleteNoteStmt = db.prepare(
  'DELETE FROM notes WHERE id = ? AND user_id = ?'
);
const listNotesStmt = db.prepare(
  `SELECT * FROM notes WHERE user_id = ? 
   AND (? IS NULL OR target_id = ?) 
   AND (? IS NULL OR type = ?)
   ORDER BY created_at DESC`
);

const insertGoalStmt = db.prepare(
  'INSERT INTO goals (id, user_id, title, metric, target, progress, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const updateGoalStmt = db.prepare(
  'UPDATE goals SET title = ?, metric = ?, target = ?, progress = ? WHERE id = ? AND user_id = ?'
);
const deleteGoalStmt = db.prepare(
  'DELETE FROM goals WHERE id = ? AND user_id = ?'
);
const listGoalsStmt = db.prepare(
  'SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC'
);

function mapNote(row) {
  return {
    id: row.id,
    uid: row.user_id,
    targetId: row.target_id,
    type: row.type,
    text: row.text,
    createdAt: row.created_at,
  };
}

function mapGoal(row) {
  return {
    id: row.id,
    uid: row.user_id,
    title: row.title,
    metric: row.metric,
    target: row.target,
    progress: row.progress,
    createdAt: row.created_at,
  };
}

function toSafeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    faceitId: row.faceit_id,
    createdAt: row.created_at,
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const bearer = req.headers.authorization;
  const cookieToken = req.cookies?.token;
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : cookieToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function num(value, fallback = 0) {
  if (value == null) return fallback;
  const n =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace('%', ''));
  return Number.isFinite(n) ? n : fallback;
}

function isRateLimitError(error) {
  if (!error) return false;
  const status = error.status || error.code;
  const message = String(error.message || '').toLowerCase();
  return (
    status === 429 ||
    status === 403 ||
    status === 401 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('limit exceeded') ||
    message.includes('unauthorized')
  );
}

async function faceitFetch(path, params) {
  const url = new URL(path.startsWith('http') ? path : `${FACEIT_API}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const keysCount = keyManager.getStats().length || 1;
  const maxAttempts =
    keysCount * Math.max(1, Number(process.env.FACEIT_MAX_RETRIES || 2));
  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    const apiKey = keyManager.getCurrentKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );
    try {
      const resp = await fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const text = await resp.text();
        const error = new Error(`Faceit API error ${resp.status}: ${text}`);
        error.status = resp.status;
        throw error;
      }
      keyManager.markKeySuccess(apiKey);
      return await resp.json();
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${REQUEST_TIMEOUT_MS} ms`);
      }
      if (isRateLimitError(error)) {
        keyManager.markKeyFailed(apiKey);
        attempt += 1;
        continue;
      }
      // для прочих ошибок попробуем следующую попытку с другим ключом
      attempt += 1;
    }
  }
  throw lastError;
}

// ---------- Auth routes ----------
app.post('/api/auth/register', (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const existing = findUserByEmail.get(email);
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  insertUser.run(id, email, hash, displayName || null, null, now);
  const user = toSafeUser(findUserById.get(id));
  const token = signToken(user);
  res
    .cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    })
    .json(user);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const userRow = findUserByEmail.get(email);
  if (!userRow) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = bcrypt.compareSync(password, userRow.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const user = toSafeUser(userRow);
  const token = signToken(user);
  res
    .cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    })
    .json(user);
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = toSafeUser(findUserById.get(req.userId));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(user);
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token').json({ ok: true });
});

// ---------- Profile & favorites ----------
app.get('/api/profile', authMiddleware, (req, res) => {
  const user = toSafeUser(findUserById.get(req.userId));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const favs = listFavorites.all(req.userId).map((r) => r.player_id);
  res.json({ ...user, favoritePlayerIds: favs });
});

app.patch('/api/profile', authMiddleware, (req, res) => {
  const { displayName, faceitId } = req.body || {};
  const user = toSafeUser(findUserById.get(req.userId));
  if (!user) return res.status(404).json({ error: 'Not found' });
  updateUserProfileStmt.run(displayName || null, faceitId || null, req.userId);
  const updated = toSafeUser(findUserById.get(req.userId));
  const favs = listFavorites.all(req.userId).map((r) => r.player_id);
  res.json({ ...updated, favoritePlayerIds: favs });
});

app.get('/api/favorites', authMiddleware, (req, res) => {
  const favs = listFavorites.all(req.userId).map((r) => r.player_id);
  res.json({ items: favs });
});

app.post('/api/favorites', authMiddleware, (req, res) => {
  const { playerId } = req.body || {};
  if (!playerId) return res.status(400).json({ error: 'playerId required' });
  try {
    insertFavorite.run(
      crypto.randomUUID(),
      req.userId,
      playerId,
      new Date().toISOString()
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(409).json({ error: 'Already exists' });
  }
});

app.delete('/api/favorites/:playerId', authMiddleware, (req, res) => {
  deleteFavorite.run(req.userId, req.params.playerId);
  res.json({ ok: true });
});

// ---------- Notes ----------
app.get('/api/notes', authMiddleware, (req, res) => {
  const { targetId = null, type = null } = req.query;
  const rows = listNotesStmt.all(
    req.userId,
    targetId || null,
    targetId || null,
    type || null,
    type || null
  );
  res.json({ items: rows.map(mapNote) });
});

app.post('/api/notes', authMiddleware, (req, res) => {
  const { targetId, type, text } = req.body || {};
  if (!targetId || !type || !text) {
    return res.status(400).json({ error: 'targetId, type, text required' });
  }
  const id = crypto.randomUUID();
  insertNoteStmt.run(
    id,
    req.userId,
    targetId,
    type,
    text,
    new Date().toISOString()
  );
  res.json({ id });
});

app.patch('/api/notes/:id', authMiddleware, (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  updateNoteStmt.run(text, req.params.id, req.userId);
  res.json({ ok: true });
});

app.delete('/api/notes/:id', authMiddleware, (req, res) => {
  deleteNoteStmt.run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ---------- Goals ----------
app.get('/api/goals', authMiddleware, (req, res) => {
  const rows = listGoalsStmt.all(req.userId);
  res.json({ goals: rows.map(mapGoal) });
});

app.post('/api/goals', authMiddleware, (req, res) => {
  const { title, metric, target, progress } = req.body || {};
  if (!title || !metric) {
    return res.status(400).json({ error: 'title and metric required' });
  }
  const id = crypto.randomUUID();
  insertGoalStmt.run(
    id,
    req.userId,
    title,
    metric,
    target ?? null,
    progress ?? 0,
    new Date().toISOString()
  );
  res.json({ id });
});

app.patch('/api/goals/:id', authMiddleware, (req, res) => {
  const { title, metric, target, progress } = req.body || {};
  if (!title || !metric) {
    return res.status(400).json({ error: 'title and metric required' });
  }
  updateGoalStmt.run(
    title,
    metric,
    target ?? null,
    progress ?? 0,
    req.params.id,
    req.userId
  );
  res.json({ ok: true });
});

app.delete('/api/goals/:id', authMiddleware, (req, res) => {
  deleteGoalStmt.run(req.params.id, req.userId);
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/faceit/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const game = String(req.query.game || DEFAULT_GAME);
    if (!q) return res.status(400).json({ error: 'q required' });

    const data = await faceitFetch('/search/players', {
      nickname: q,
      game,
      limit: 5,
      offset: 0,
    });

    const enriched = await Promise.all(
      (data?.items || []).map(async (p) => {
        try {
          const [player, stats] = await Promise.all([
            faceitFetch(`/players/${p.player_id}`),
            faceitFetch(`/players/${p.player_id}/stats/${game}`),
          ]);
          const lifetime = stats?.lifetime || {};
          return {
            id: p.player_id,
            nickname: p.nickname,
            avatarUrl: player?.avatar || player?.avatarUrl || null,
            country: player?.country || null,
            level: player?.games?.[game]?.level || player?.level || null,
            kdRatio: num(lifetime['Average K/D Ratio']),
            winRatePercent: num(lifetime['Win Rate %']),
            matchesPlayed: num(lifetime['Matches']),
            headshotPercent: num(lifetime['Headshots %']),
          };
        } catch {
          return {
            id: p.player_id,
            nickname: p.nickname,
            avatarUrl: null,
            country: null,
            level: null,
            kdRatio: 0,
            winRatePercent: 0,
            matchesPlayed: 0,
            headshotPercent: 0,
          };
        }
      })
    );

    return res.json(enriched);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const game = String(req.query.game || DEFAULT_GAME);

    const [player, stats] = await Promise.all([
      faceitFetch(`/players/${id}`),
      faceitFetch(`/players/${id}/stats/${game}`),
    ]);
    const lifetime = stats?.lifetime || {};

    const kd =
      lifetime['Average K/D Ratio'] ??
      lifetime['Average K/D'] ??
      lifetime['K/D Ratio'];
    const kpr =
      lifetime['Average K/R Ratio'] ??
      lifetime['Average K/R'] ??
      lifetime['K/R Ratio'];
    const matches = num(lifetime['Matches']);
    const kills = lifetime['Kills'];
    const deaths = lifetime['Deaths'];
    const rounds = lifetime['Rounds'];
    const winrate = num(lifetime['Win Rate %']);
    const computedKpr =
      kpr !== undefined
        ? kpr
        : kills !== undefined && rounds
        ? Number(kills) / Number(rounds)
        : undefined;

    const elo = player?.games?.[game]?.faceit_elo ?? player?.faceit_elo;
    const highestElo =
      lifetime['Highest ELO'] ??
      lifetime['Highest Elo'] ??
      lifetime['Highest Elo'] ??
      null;
    const lowestElo =
      lifetime['Lowest ELO'] ??
      lifetime['Lowest Elo'] ??
      lifetime['Lowest Elo'] ??
      null;
    const avgElo =
      lifetime['Average ELO'] ??
      lifetime['Average Elo'] ??
      lifetime['Average Elo'] ??
      null;

    const wins = lifetime['Wins'];
    const losses = lifetime['Losses'];

    const faRating = lifetime['FA Rating'] ?? lifetime['Average FA Rating'];
    const hltv = lifetime['HLTV Rating'] ?? lifetime['Average HLTV Rating'];

    const headshots = lifetime['Headshots %'];

    const summary = {
      id: player.player_id,
      nickname: player.nickname,
      kdRatio: num(kd),
      winRatePercent: winrate,
      matchesPlayed: matches,
      headshotPercent: num(headshots),
      kpr: num(computedKpr),
      kills: num(kills),
      deaths: num(deaths),
      wins: num(wins),
      losses: num(losses),
      elo: num(elo),
      highestElo: num(highestElo),
      lowestElo: num(lowestElo),
      avgElo: num(avgElo),
      faRating: num(faRating),
      hltv: num(hltv),
      avatarUrl: player?.avatar ?? null,
      country: player?.country ?? null,
      level: player?.games?.[game]?.skill_level ?? null,
    };
    return res.json(summary);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/players/:id/matches', async (req, res) => {
  try {
    const { id } = req.params;
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    const hist = await faceitFetch(`/players/${id}/history`, {
      game,
      limit,
      offset,
    });

    const items = (hist?.items || []).map((m) => {
      const raw = m.played_at;
      const t = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
      const playedAt = Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : Date.now();
      return {
        matchId: m.match_id,
        game: m.game_id,
        playedAt,
        region: m.region,
        team: m.team,
        map: m.map,
      };
    });
    return res.json({ items, total: hist?.total || items.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/players/:id/matches/details', async (req, res) => {
  try {
    const { id } = req.params;
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    const hist = await faceitFetch(`/players/${id}/history`, {
      game,
      limit,
      offset,
    });

    const items = hist?.items || [];
    if (items.length === 0) {
      return res.json({ items: [], total: 0 });
    }

    const concurrency = 5;
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency)
      chunks.push(items.slice(i, i + concurrency));

    const detailed = [];

    for (const group of chunks) {
      const results = await Promise.all(
        group.map(async (m) => {
          try {
            const [matchData, matchStats] = await Promise.all([
              faceitFetch(`/matches/${m.match_id}`),
              faceitFetch(`/matches/${m.match_id}/stats`).catch(() => null),
            ]);
            return { ...matchData, stats: matchStats };
          } catch {
            return null;
          }
        })
      );

      for (const md of results) {
        if (!md) continue;

        const allPlayers = [];
        const teamByKey = {
          faction1: md?.teams?.faction1,
          faction2: md?.teams?.faction2,
        };

        ['faction1', 'faction2'].forEach((key) => {
          const t = teamByKey[key];
          const roster = t?.roster || [];
          for (const pl of roster) {
            allPlayers.push({
              player_id: pl?.player_id,
              nickname: pl?.nickname,
              teamKey: key,
              teamName: t?.name,
              player_stats: pl?.player_stats,
            });
          }
        });

        const me = allPlayers.find((p) => p.player_id === id);
        if (!me) continue;

        let winnerKey;
        let scoreFor = 0;
        let scoreAgainst = 0;

        const resultsObj = md?.results;
        if (resultsObj) {
          if (
            resultsObj.winner === 'faction1' ||
            resultsObj.winner === 'faction2'
          ) {
            winnerKey = resultsObj.winner;
          }
        }

        let team1Score = 0;
        let team2Score = 0;

        let statsData = null;
        try {
          statsData = await faceitFetch(`/matches/${md?.match_id}/stats`);
        } catch {
          // ignore
        }

        if (statsData?.rounds?.length > 0) {
          try {
            const firstRound = statsData.rounds[0];
            const teamsArr = Array.isArray(firstRound?.teams)
              ? firstRound.teams
              : [];
            const scoreByFaction = { faction1: 0, faction2: 0 };
            for (const team of teamsArr) {
              const factionId = team?.team_id;
              if (factionId !== 'faction1' && factionId !== 'faction2') continue;
              const ts = team?.team_stats || {};
              const rawScore =
                ts.Score ??
                ts['Final Score'] ??
                ts['Final score'] ??
                ts['Rounds'] ??
                ts['Rounds Won'] ??
                ts['RoundsWon'];
              let parsed = 0;
              if (typeof rawScore === 'number') parsed = rawScore;
              else if (typeof rawScore === 'string') {
                const m = rawScore.match(/\d+/);
                if (m) parsed = Number(m[0]);
              }
              if (parsed > 0) scoreByFaction[factionId] = parsed;
            }
            if (scoreByFaction.faction1 > 0 || scoreByFaction.faction2 > 0) {
              team1Score = scoreByFaction.faction1;
              team2Score = scoreByFaction.faction2;
            }
          } catch {
            // ignore
          }

          if (team1Score === 0 && team2Score === 0) {
            try {
              const firstRound = statsData.rounds[0];
              const rs = firstRound?.round_stats || {};
              const rawCombined =
                rs.Score ??
                rs.score ??
                rs.Result ??
                rs['Final Score'] ??
                rs['Final score'];
              if (typeof rawCombined === 'string') {
                const m = rawCombined.match(/(\d+)\s*[-\/:]\s*(\d+)/);
                if (m) {
                  let a = Number(m[1]);
                  let b = Number(m[2]);
                  if (winnerKey === 'faction1' && a < b) [a, b] = [b, a];
                  else if (winnerKey === 'faction2' && b < a) [a, b] = [b, a];
                  team1Score = a;
                  team2Score = b;
                }
              }
            } catch {
              // ignore
            }
          }

          if (
            team1Score === 0 &&
            team2Score === 0 &&
            statsData.rounds.length > 1
          ) {
            let faction1Rounds = 0;
            let faction2Rounds = 0;
            for (const round of statsData.rounds) {
              if (round?.winner === 'faction1') faction1Rounds++;
              else if (round?.winner === 'faction2') faction2Rounds++;
            }
            if (faction1Rounds > 0 || faction2Rounds > 0) {
              team1Score = faction1Rounds;
              team2Score = faction2Rounds;
            }
          }
        }

        if (
          team1Score === 0 &&
          team2Score === 0 &&
          Array.isArray(md?.detailed_results) &&
          md.detailed_results.length > 0
        ) {
          for (const result of md.detailed_results) {
            if (result?.factions && typeof result.factions === 'object') {
              const factionKeys = Object.keys(result.factions);
              const faction1Data = result.factions[factionKeys[0]];
              const faction2Data = result.factions[factionKeys[1]];

              const faction1Score = Number(faction1Data?.score ?? 0);
              const faction2Score = Number(faction2Data?.score ?? 0);

              if (faction1Score > 1 || faction2Score > 1) {
                team1Score = faction1Score;
                team2Score = faction2Score;
                break;
              }
            }
          }
        }

        if (
          team1Score === 0 &&
          team2Score === 0 &&
          md?.results?.score &&
          typeof md.results.score === 'object'
        ) {
          const scoreObj = md.results.score;
          const scoreValues = Object.values(scoreObj).map(Number);
          if (scoreValues.some((v) => v > 1)) {
            const scoreKeys = Object.keys(scoreObj);
            team1Score = Number(scoreObj[scoreKeys[0]] ?? 0);
            team2Score = Number(scoreObj[scoreKeys[1]] ?? 0);
          }
        }

        if (team1Score === 0 && team2Score === 0) {
          if (md?.teams?.faction1?.stats) {
            team1Score = Number(
              md.teams.faction1.stats.Score ??
                md.teams.faction1.stats.score ??
                0
            );
          }
          if (md?.teams?.faction2?.stats) {
            team2Score = Number(
              md.teams.faction2.stats.Score ??
                md.teams.faction2.stats.score ??
                0
            );
          }
        }

        if (team1Score === 0 && team2Score === 0 && md?.results) {
          if (md.results.faction1 && typeof md.results.faction1 === 'object') {
            team1Score = Number(
              md.results.faction1.score ?? md.results.faction1.Score ?? 0
            );
          }
          if (md.results.faction2 && typeof md.results.faction2 === 'object') {
            team2Score = Number(
              md.results.faction2.score ?? md.results.faction2.Score ?? 0
            );
          }
        }

        if (team1Score === 0 && team2Score === 0 && md?.results?.score) {
          const scoreObj = md.results.score;
          const scoreKeys = Object.keys(scoreObj);
          team1Score = Number(scoreObj[scoreKeys[0]] ?? 0);
          team2Score = Number(scoreObj[scoreKeys[1]] ?? 0);
        }

        if (me.teamKey === 'faction1') {
          scoreFor = team1Score;
          scoreAgainst = team2Score;
          if (!winnerKey && team1Score !== team2Score) {
            winnerKey = team1Score > team2Score ? 'faction1' : 'faction2';
          }
        } else {
          scoreFor = team2Score;
          scoreAgainst = team1Score;
          if (!winnerKey && team1Score !== team2Score) {
            winnerKey = team2Score > team1Score ? 'faction2' : 'faction1';
          }
        }

        let kills = 0;
        let deaths = 0;
        let headshots = 0;

        if (md?.stats?.rounds?.length > 0) {
          for (const round of md.stats.rounds) {
            const teams = round?.teams || [];
            for (const team of teams) {
              const players = team?.players || [];
              const playerStats = players.find((p) => p.player_id === id);

              if (playerStats?.player_stats) {
                kills = num(
                  playerStats.player_stats?.Kills ||
                    playerStats.player_stats?.kills
                );
                deaths = num(
                  playerStats.player_stats?.Deaths ||
                    playerStats.player_stats?.deaths
                );
                headshots = num(
                  playerStats.player_stats?.Headshots ||
                    playerStats.player_stats?.headshots
                );
                break;
              }
            }
            if (kills > 0 || deaths > 0) break;
          }
        }

        if (kills === 0 && deaths === 0 && me?.player_stats) {
          kills = num(me.player_stats?.Kills || me.player_stats?.kills);
          deaths = num(me.player_stats?.Deaths || me.player_stats?.deaths);
          headshots = num(
            me.player_stats?.Headshots || me.player_stats?.headshots
          );
        }

        if (kills === 0 && deaths === 0) {
          const matchPlayers = md?.players || [];
          const matchPlayer = matchPlayers.find((p) => p.player_id === id);
          if (matchPlayer) {
            kills = num(matchPlayer.kills || matchPlayer.Kills);
            deaths = num(matchPlayer.deaths || matchPlayer.Deaths);
            headshots = num(matchPlayer.headshots || matchPlayer.Headshots);
          }
        }

        const kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
        const win = winnerKey ? winnerKey === me.teamKey : undefined;

        const matchDetail = {
          matchId: md?.match_id,
          game: md?.game || md?.game_id,
          playedAt: (() => {
            const raw = md?.started_at ?? md?.date ?? md?.finished_at ?? 0;
            if (typeof raw === 'string') {
              const d = Date.parse(raw);
              return Number.isFinite(d) ? d : Date.now();
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) return Date.now();
            return n < 1e12 ? n * 1000 : n;
          })(),
          region: md?.region || 'unknown',
          map: md?.voting?.map?.pick || md?.map || md?.maps?.[0]?.name,
          win,
          team: me?.teamName,
          kills,
          deaths,
          headshots,
          kd,
          scoreFor,
          scoreAgainst,
        };

        detailed.push(matchDetail);
      }
    }

    detailed.sort((a, b) => b.playedAt - a.playedAt);

    return res.json({ items: detailed, total: detailed.length });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/players/:id/teammates', async (req, res) => {
  try {
    const { id } = req.params;
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    const hist = await faceitFetch(`/players/${id}/history`, {
      game,
      limit,
      offset,
    });
    const items = hist?.items || [];

    const concurrency = 5;
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency)
      chunks.push(items.slice(i, i + concurrency));

    const teammateToStats = {};

    for (const group of chunks) {
      const results = await Promise.all(
        group.map(async (m) => {
          try {
            return await faceitFetch(`/matches/${m.match_id}`);
          } catch {
            return null;
          }
        })
      );
      for (const md of results) {
        if (!md) continue;
        const teams =
          md?.teams?.faction1 && md?.teams?.faction2
            ? [md.teams.faction1, md.teams.faction2]
            : [];
        const allPlayers = [];
        for (const t of teams) {
          const roaster = t?.roster || [];
          for (const pl of roaster) {
            allPlayers.push({
              player_id: pl?.player_id,
              nickname: pl?.nickname,
              team: t?.name,
            });
          }
        }
        const me = allPlayers.find((p) => p.player_id === id);
        if (!me) continue;
        const myTeam = me.team;
        for (const p of allPlayers) {
          if (p.player_id === id) continue;
          if (p.team !== myTeam) continue;
          const key = p.player_id;
          if (!teammateToStats[key])
            teammateToStats[key] = { nickname: p.nickname, matches: 0 };
          teammateToStats[key].matches += 1;
        }
      }
    }

    const list = Object.entries(teammateToStats)
      .map(([tid, s]) => ({
        id: tid,
        nickname: s.nickname,
        matchesTogether: s.matches,
      }))
      .sort((a, b) => b.matchesTogether - a.matchesTogether);

    return res.json({ items: list });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/players/:id/maps', async (req, res) => {
  try {
    const { id } = req.params;
    const game = String(req.query.game || DEFAULT_GAME);
    const stats = await faceitFetch(`/players/${id}/stats/${game}`);
    const segments = Array.isArray(stats?.segments) ? stats.segments : [];
    const maps = segments
      .filter((s) => s?.type === 'map')
      .map((s) => ({
        map: s?.label || s?.mode || 'Unknown',
        winRatePercent: num(s?.stats?.['Win Rate %']),
        kdRatio: num(
          s?.stats?.['Average K/D Ratio'] ??
            s?.stats?.['Average K/D'] ??
            s?.stats?.['K/D Ratio']
        ),
        matchesPlayed: num(s?.stats?.Matches),
      }));
    return res.json({ items: maps });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/debug/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const [md, ms] = await Promise.all([
      faceitFetch(`/matches/${matchId}`),
      faceitFetch(`/matches/${matchId}/stats`).catch(() => null),
    ]);

    res.json({
      matchId: md?.match_id,
      basicMatch: {
        hasTeams: !!md?.teams,
        hasPlayers: !!md?.players,
        hasRounds: !!md?.rounds,
        teamsStructure: {
          faction1: {
            hasRoster: !!md?.teams?.faction1?.roster,
            rosterCount: md?.teams?.faction1?.roster?.length || 0,
            samplePlayer: md?.teams?.faction1?.roster?.[0] || null,
          },
          faction2: {
            hasRoster: !!md?.teams?.faction2?.roster,
            rosterCount: md?.teams?.faction2?.roster?.length || 0,
            samplePlayer: md?.teams?.faction2?.roster?.[0] || null,
          },
        },
      },
      statsEndpoint: {
        available: !!ms,
        hasRounds: !!ms?.rounds,
        roundsCount: ms?.rounds?.length || 0,
        sampleStatsRound: ms?.rounds?.[0]
          ? {
              hasTeams: !!ms.rounds[0].teams,
              teamsCount: ms.rounds[0].teams?.length || 0,
              sampleTeam: ms.rounds[0].teams?.[0]
                ? {
                    hasPlayers: !!ms.rounds[0].teams[0].players,
                    playersCount: ms.rounds[0].teams[0].players?.length || 0,
                    samplePlayer: ms.rounds[0].teams[0].players?.[0] || null,
                  }
                : null,
            }
          : null,
      },
      rawMatch: md,
      rawStats: ms,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/matches/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const [md, ms] = await Promise.all([
      faceitFetch(`/matches/${matchId}`),
      faceitFetch(`/matches/${matchId}/stats`).catch(() => null),
    ]);
    const toMs = (v) => {
      if (typeof v === 'string') {
        const d = Date.parse(v);
        return Number.isFinite(d) ? d : Date.now();
      }
      const n = Number(v);
      return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.now();
    };
    const statPlayersById = {};
    const rounds = Array.isArray(ms?.rounds) ? ms.rounds : [];
    for (const r of rounds) {
      const tms = Array.isArray(r?.teams) ? r.teams : [];
      for (const team of tms) {
        const players = Array.isArray(team?.players) ? team.players : [];
        for (const p of players) {
          const pid = p?.player_id;
          if (!pid) continue;
          const k = num(p?.player_stats?.Kills);
          const d = num(p?.player_stats?.Deaths);
          const h = num(p?.player_stats?.Headshots);
          statPlayersById[pid] = { kills: k, deaths: d, hs: h };
        }
      }
    }

    const extractedScores = { faction1: 0, faction2: 0 };
    if (Array.isArray(md?.detailed_results) && md.detailed_results.length > 0) {
      for (const result of md.detailed_results) {
        if (result?.factions && typeof result.factions === 'object') {
          const factionKeys = Object.keys(result.factions);

          if (factionKeys.length >= 2) {
            const faction1Data = result.factions[factionKeys[0]];
            const faction2Data = result.factions[factionKeys[1]];

            const faction1Score = Number(faction1Data?.score ?? 0);
            const faction2Score = Number(faction2Data?.score ?? 0);

            if (faction1Score > 0 || faction2Score > 0) {
              extractedScores.faction1 = faction1Score;
              extractedScores.faction2 = faction2Score;
              break;
            }
          }
        }
      }
    }

    if (
      extractedScores.faction1 === 0 &&
      extractedScores.faction2 === 0 &&
      Array.isArray(ms?.rounds) &&
      ms.rounds.length > 0
    ) {
      let faction1Rounds = 0;
      let faction2Rounds = 0;

      for (const round of ms.rounds) {
        if (round?.winner === 'faction1') faction1Rounds++;
        else if (round?.winner === 'faction2') faction2Rounds++;
      }

      if (faction1Rounds > 1 || faction2Rounds > 1) {
        extractedScores.faction1 = faction1Rounds;
        extractedScores.faction2 = faction2Rounds;
      }
    }

    if (
      extractedScores.faction1 === 0 &&
      extractedScores.faction2 === 0 &&
      md?.results?.score &&
      typeof md.results.score === 'object'
    ) {
      const scoreObj = md.results.score;
      const scoreValues = Object.values(scoreObj).map(Number);
      if (scoreValues.some((v) => v > 1)) {
        const scoreKeys = Object.keys(scoreObj);
        extractedScores.faction1 = Number(scoreObj[scoreKeys[0]] ?? 0);
        extractedScores.faction2 = Number(scoreObj[scoreKeys[1]] ?? 0);
      }
    }

    const teams = ['faction1', 'faction2'];
    const scoreboard = teams.map((key) => {
      const t = md?.teams?.[key] || {};
      const roster = Array.isArray(t?.roster) ? t.roster : [];

      let score = 0;
      if (extractedScores.faction1 > 0 || extractedScores.faction2 > 0) {
        score = key === 'faction1' ? extractedScores.faction1 : extractedScores.faction2;
      } else {
        score = num(t?.stats?.Score ?? t?.stats?.score ?? 0);
      }

      return {
        key,
        name: t?.name,
        score,
        players: roster.map((pl) => {
          const pid = pl?.player_id;
          const fromStats = pid ? statPlayersById[pid] : undefined;
          const kills = fromStats ? fromStats.kills : num(pl?.player_stats?.Kills);
          const deaths = fromStats ? fromStats.deaths : num(pl?.player_stats?.Deaths);
          const hs = fromStats ? fromStats.hs : num(pl?.player_stats?.Headshots);
          const kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
          return {
            id: pid,
            nickname: pl?.nickname,
            kills,
            deaths,
            hs,
            kd,
            avatarUrl: pl?.avatar,
            level: pl?.skill_level,
          };
        }),
      };
    });
    const winner =
      md?.results?.winner ??
      (scoreboard[0].score === scoreboard[1].score
        ? null
        : scoreboard[0].score > scoreboard[1].score
        ? 'faction1'
        : 'faction2');

    const scoreFor = scoreboard[0].score;
    const scoreAgainst = scoreboard[1].score;

    res.json({
      matchId: md?.match_id,
      game: md?.game || md?.game_id,
      map: md?.voting?.map?.pick || md?.map || md?.maps?.[0]?.name,
      startedAt: toMs(md?.started_at),
      finishedAt: toMs(md?.finished_at),
      region: md?.region,
      scoreboard,
      winner,
      scoreFor,
      scoreAgainst,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/debug/match-quick/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const md = await faceitFetch(`/matches/${matchId}`);

    const detailedScoreAnalysis = [];
    if (Array.isArray(md?.detailed_results)) {
      for (const result of md.detailed_results) {
        if (result?.factions) {
          const factionKeys = Object.keys(result.factions);
          const scoreData = {};
          factionKeys.forEach((key) => {
            scoreData[key] = {
              rawData: result.factions[key],
              score: result.factions[key]?.score,
              scoreAsNumber: Number(result.factions[key]?.score ?? 0),
            };
          });
          detailedScoreAnalysis.push({
            winner: result.winner,
            factionKeys,
            scores: scoreData,
          });
        }
      }
    }

    const quickAnalysis = {
      matchId,
      status: md?.status,
      winner: md?.results?.winner,
      resultsScore: md?.results?.score,
      detailedResults: md?.detailed_results,
      detailedScoreAnalysis,
      teamsScore: {
        faction1: md?.teams?.faction1?.stats,
        faction2: md?.teams?.faction2?.stats,
      },
      possibleRoundScores: {
        fromDetailedResults:
          md?.detailed_results?.map((r) => r?.factions) || [],
        fromResultsScore: md?.results?.score,
        analysis: {
          resultsScoreValues: md?.results?.score
            ? Object.values(md.results.score)
            : [],
          hasDetailedResults: !!md?.detailed_results?.length,
          detailedResultsCount: md?.detailed_results?.length || 0,
        },
      },
      rawResults: md?.results,
      rawTeams: md?.teams,
    };

    res.json(quickAnalysis);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

app.get('/api/faceit/debug/match-score/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const md = await faceitFetch(`/matches/${matchId}`);

    const analysis = {
      matchId,
      resultsScore: {
        exists: !!md?.results?.score,
        type: typeof md?.results?.score,
        keys: md?.results?.score ? Object.keys(md.results.score) : [],
        values: md?.results?.score ? Object.values(md.results.score) : [],
        raw: md?.results?.score,
      },
      teamsScore: {
        faction1:
          md?.teams?.faction1?.stats?.Score ??
          md?.teams?.faction1?.stats?.score ??
          null,
        faction2:
          md?.teams?.faction2?.stats?.Score ??
          md?.teams?.faction2?.stats?.score ??
          null,
      },
      teamsStructure: md?.teams ? Object.keys(md.teams) : [],
      resultsWinner: md?.results?.winner,
      recommendation: null,
    };

    if (
      analysis.resultsScore.exists &&
      analysis.resultsScore.values.some((v) => Number(v) > 0)
    ) {
      analysis.recommendation = `Use results.score with keys: ${analysis.resultsScore.keys.join(
        ', '
      )} and values: ${analysis.resultsScore.values.join(', ')}`;
    } else if (analysis.teamsScore.faction1 || analysis.teamsScore.faction2) {
      analysis.recommendation = `Use teams stats: faction1=${analysis.teamsScore.faction1}, faction2=${analysis.teamsScore.faction2}`;
    } else {
      analysis.recommendation = 'No valid scores found';
    }

    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// ---------- Static client (if built) ----------
const staticPath = path.join(__dirname, '..', 'dist', 'finance-tracker', 'browser');
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(staticPath, 'index.html'));
  });
}

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Local API server is running at http://127.0.0.1:${port}/api/health`
    );
  });
}

module.exports = app;

