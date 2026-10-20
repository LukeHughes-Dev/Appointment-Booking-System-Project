import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const plain = buildTestApp();
afterAll(() => plain.close());

describe('response headers', () => {
  it('sends the standard safe headers', async () => {
    const res = await plain.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    const policy = String(res.headers['content-security-policy']);
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain('upgrade-insecure-requests'); // the docs page must work over plain http locally
  });
});

describe('OpenAPI description', () => {
  it('lists the routes, and marks the ones that need sign-in', async () => {
    const res = await plain.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.info.title).toBe('Appointment Booking API');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health', '/services', '/appointments', '/appointments/{reference}/reschedule', '/staff/summary']),
    );
    expect(doc.paths['/appointments'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/services'].get.security).toBeUndefined();
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('has a browsable page', async () => {
    const res = await plain.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('rate limiting', () => {
  it('refuses a caller who goes over the general limit, but never the health check', async () => {
    const limited = buildTestApp(undefined, { rateLimit: { max: 3 } });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: 'GET', url: '/services' })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const refused = await limited.inject({ method: 'GET', url: '/services' });
    expect(refused.headers['retry-after']).toBeDefined();
    expect((await limited.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await limited.close();
  });

  it('limits requests that change things much more tightly', async () => {
    const limited = buildTestApp(undefined, { rateLimit: { max: 1000 } });
    const codes = [];
    for (let i = 0; i < 22; i++) codes.push((await limited.inject({ method: 'POST', url: '/appointments', payload: {} })).statusCode);
    expect(codes.slice(0, 20).every((c) => c !== 429)).toBe(true); // refused for other reasons, but counted
    expect(codes.slice(20)).toEqual([429, 429]);
    await limited.close();
  });
});
