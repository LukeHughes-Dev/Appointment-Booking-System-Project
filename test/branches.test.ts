import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('GET /branches', () => {
  it('lists the seeded branches', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/branches' });

    expect(res.statusCode).toBe(200);
    const branches = res.json();
    expect(branches).toHaveLength(6);
    expect(branches.map((b: { name: string }) => b.name)).toContain('Pretoria Hatfield');

    await app.close();
  });
});
