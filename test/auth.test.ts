import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, tokenFor } from './helpers.js';

const app = buildTestApp();
afterAll(() => app.close());

function me(token?: string) {
  return app.inject({
    method: 'GET',
    url: '/me',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('sign-in', () => {
  it('returns who you are for a valid token', async () => {
    const res = await me(
      await tokenFor({ sub: 'abc-123', email: 'luke@example.com', name: 'Luke H', roles: ['consultant'] }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sub: 'abc-123',
      email: 'luke@example.com',
      name: 'Luke H',
      roles: ['consultant'],
    });
  });

  it('gives a customer no roles', async () => {
    expect((await me(await tokenFor())).json().roles).toEqual([]);
  });

  it('rejects a request with no token', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects tokens that are not valid', async () => {
    const bad = [
      'not-a-token',
      await tokenFor({ signedByUntrustedKey: true }), // signed with a key we do not trust
      await tokenFor({ issuer: 'http://somewhere-else/realms/booking' }),
      await tokenFor({ audience: 'another-api' }),
      await tokenFor({ expiresIn: '-1m' }), // already expired
    ];
    for (const token of bad) {
      const res = await me(token);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Invalid or expired sign-in'); // same message for every reason
    }
  });
});
