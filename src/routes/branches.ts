import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

interface BranchRoutesOptions {
  pool: Pool;
  now: () => Date;
}

interface BranchQuery {
  lat?: number;
  lng?: number;
  q?: string;
}

// Distance in km between the client (lat $1, lng $2) and a branch, by the haversine formula.
const DISTANCE_KM = `
  2 * 6371 * asin(sqrt(
    power(sin(radians(b.latitude - $1::float8) / 2), 2) +
    cos(radians($1::float8)) * cos(radians(b.latitude)) *
    power(sin(radians(b.longitude - $2::float8) / 2), 2)
  ))`;

export const branchRoutes: FastifyPluginAsync<BranchRoutesOptions> = async (app, { pool, now }) => {
  // The client's position is only used to sort this one response. It is never stored.
  app.get<{ Querystring: BranchQuery }>(
    '/branches',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            q: { type: 'string', maxLength: 60 },
          },
          // A position needs both numbers.
          dependencies: { lat: ['lng'], lng: ['lat'] },
        },
      },
    },
    async (request) => {
      const { lat = null, lng = null, q = null } = request.query;

      const { rows } = await pool.query(
        `SELECT b.id::text AS id, b.name, b.timezone, b.latitude, b.longitude,
                CASE WHEN $1::float8 IS NULL THEN NULL
                     ELSE round((${DISTANCE_KM})::numeric, 1)::float8 END AS distance_km,
                c.closed_from::text AS closed_from, c.closed_to::text AS closed_to, c.reason
         FROM branches b
         LEFT JOIN branch_closures c
           ON c.branch_id = b.id
          AND ($3::timestamptz AT TIME ZONE b.timezone)::date BETWEEN c.closed_from AND c.closed_to
         WHERE $4::text IS NULL OR strpos(lower(b.name), lower($4::text)) > 0
         ORDER BY distance_km NULLS LAST, b.name`,
        [lat, lng, now().toISOString(), q],
      );

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        timezone: r.timezone,
        latitude: r.latitude,
        longitude: r.longitude,
        distanceKm: r.distance_km,
        // Set while the branch is closed today (for example the revamp).
        closure: r.closed_from ? { from: r.closed_from, to: r.closed_to, reason: r.reason } : null,
      }));
    },
  );
};
