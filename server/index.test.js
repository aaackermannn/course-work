const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

process.env.FACEIT_API_KEY = 'test-key';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'faceit-db-')),
  'data.db'
);

const app = require('./index.js');

describe('Server API (auth/profile/favorites/notes/goals)', () => {
  let agent;
  beforeAll(() => {
    agent = request.agent(app);
  });

  test('health returns ok', async () => {
    const res = await agent.get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('register -> me -> favorites/notes/goals flow', async () => {
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'secret' })
      .expect(200);
    expect(reg.body.email).toBe('test@example.com');

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe('test@example.com');

    await agent
      .post('/api/favorites')
      .send({ playerId: 'player-1' })
      .expect(200);

    const profile = await agent.get('/api/profile').expect(200);
    expect(profile.body.favoritePlayerIds).toContain('player-1');

    const noteResp = await agent
      .post('/api/notes')
      .send({ targetId: 'general', type: 'match', text: 'hello' })
      .expect(200);
    expect(noteResp.body.id).toBeDefined();

    const notesList = await agent.get('/api/notes').expect(200);
    expect(notesList.body.items.length).toBe(1);
    expect(notesList.body.items[0].text).toBe('hello');

    const goalResp = await agent
      .post('/api/goals')
      .send({ title: 'Win more', metric: 'winrate', target: 60, progress: 10 })
      .expect(200);
    expect(goalResp.body.id).toBeDefined();

    const goalsList = await agent.get('/api/goals').expect(200);
    expect(goalsList.body.goals.length).toBe(1);
    expect(goalsList.body.goals[0].title).toBe('Win more');
  });

  test('rejects unauthorized access and validates inputs', async () => {
    await request(app).get('/api/profile').expect(401);

    await agent
      .post('/api/auth/register')
      .send({ email: 'user2@example.com', password: 'secret' })
      .expect(200);

    await agent.post('/api/favorites').send({}).expect(400);

    await agent.post('/api/notes').send({ targetId: 'x' }).expect(400);

    await agent.post('/api/goals').send({}).expect(400);
  });

  test('update/delete favorites, notes, goals, and logout', async () => {
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'secret' })
      .expect(200);
    expect(login.body.email).toBe('test@example.com');

    await agent.post('/api/favorites').send({ playerId: 'player-2' }).expect(200);
    let profile = await agent.get('/api/profile').expect(200);
    expect(profile.body.favoritePlayerIds).toContain('player-2');

    await agent.delete('/api/favorites/player-2').expect(200);
    profile = await agent.get('/api/profile').expect(200);
    expect(profile.body.favoritePlayerIds).not.toContain('player-2');

    const noteResp = await agent
      .post('/api/notes')
      .send({ targetId: 'match-1', type: 'match', text: 'note-1' })
      .expect(200);
    const noteId = noteResp.body.id;
    await agent.patch(`/api/notes/${noteId}`).send({ text: 'updated' }).expect(200);
    const notesAfter = await agent.get('/api/notes').expect(200);
    expect(notesAfter.body.items[0].text).toBe('updated');
    await agent.delete(`/api/notes/${noteId}`).expect(200);
    const notesEmpty = await agent.get('/api/notes').expect(200);
    expect(
      notesEmpty.body.items.find((n) => n.id === noteId)
    ).toBeUndefined();

    const goalResp = await agent
      .post('/api/goals')
      .send({ title: 'Target', metric: 'kd', target: 2, progress: 1 })
      .expect(200);
    const goalId = goalResp.body.id;
    await agent
      .patch(`/api/goals/${goalId}`)
      .send({ title: 'Target2', metric: 'kd', target: 2.5, progress: 1.2 })
      .expect(200);
    const goalsList = await agent.get('/api/goals').expect(200);
    expect(goalsList.body.goals[0].title).toBe('Target2');
    await agent.delete(`/api/goals/${goalId}`).expect(200);
    const goalsEmpty = await agent.get('/api/goals').expect(200);
    expect(goalsEmpty.body.goals.find((g) => g.id === goalId)).toBeUndefined();

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/profile').expect(401);
  });
});

