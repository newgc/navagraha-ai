import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('API e2e', () => {
  let app: NestExpressApplication;
  let close: () => Promise<void>;

  beforeAll(async () => ({ app, close } = await createTestApp(url!)));
  afterAll(async () => close?.());

  it('GET /v1/health', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('GET /v1/temples lists the nine Navagraha temples in order, flagged unverified', async () => {
    const res = await request(app.getHttpServer()).get('/v1/temples').expect(200);
    expect(res.body.circuit).toBe('NAVAGRAHA');
    expect(res.body.temples).toHaveLength(9);
    expect(res.body.temples[0]).toMatchObject({
      code: 'TEM-SUR',
      commonName: 'Suriyanar Kovil',
      location: null,
      verification: { status: 'TO_COLLECT', isVerified: false },
    });
    expect(res.body.temples[0].verification).not.toHaveProperty('verifiedBy');
  });

  it('GET /v1/temples/:code', async () => {
    const res = await request(app.getHttpServer()).get('/v1/temples/TEM-SHA').expect(200);
    expect(res.body).toMatchObject({ commonName: 'Thirunallar', state: 'Puducherry (Karaikal)' });
  });

  it('404s unknown temples and circuits, 400s malformed codes', async () => {
    await request(app.getHttpServer()).get('/v1/temples/TEM-XXX').expect(404);
    await request(app.getHttpServer()).get('/v1/temples?circuit=CHOLA').expect(404);
    const bad = await request(app.getHttpServer()).get('/v1/temples/drop%20table').expect(400);
    expect(bad.body).toMatchObject({ statusCode: 400, correlationId: expect.any(String) });
  });

  it('keeps a well-formed correlation ID and replaces anything else', async () => {
    const kept = await request(app.getHttpServer())
      .get('/v1/health')
      .set('x-correlation-id', 'client-trace-0001')
      .expect(200);
    expect(kept.headers['x-correlation-id']).toBe('client-trace-0001');

    const replaced = await request(app.getHttpServer())
      .get('/v1/health')
      .set('x-correlation-id', '<script>')
      .expect(200);
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not advertise the framework', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
