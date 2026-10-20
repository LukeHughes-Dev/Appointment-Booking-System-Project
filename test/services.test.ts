import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const app = buildTestApp();
afterAll(() => app.close());

describe('GET /services', () => {
  it('lists the services and how long each takes, without needing to sign in', async () => {
    const res = await app.inject({ method: 'GET', url: '/services' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { name: 'Save', minutes: 60 },
      { name: 'Transact', minutes: 30 },
      { name: 'Credit', minutes: 90 },
    ]);
  });
});
