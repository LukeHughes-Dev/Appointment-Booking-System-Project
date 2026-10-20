import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { requireRole, type createAuthenticate } from '../auth.js';
import { listMessages, sendMessage, type Party } from '../messages.js';
import { writeLimit } from '../limits.js';

interface MessageRoutesOptions {
  pool: Pool;
  now: () => Date;
  authenticate: ReturnType<typeof createAuthenticate>;
}

const params = {
  type: 'object',
  required: ['reference'],
  properties: { reference: { type: 'string', pattern: '^APT-[0-9A-F]{10}$' } },
} as const;
const querystring = {
  type: 'object',
  properties: { after: { type: 'string', pattern: '^[0-9]+$' } },
} as const;
const body = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: { body: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } },
} as const;

export const messageRoutes: FastifyPluginAsync<MessageRoutesOptions> = async (
  app,
  { pool, now, authenticate },
) => {
  async function consultantIdFor(email: string) {
    const { rows } = await pool.query(
      'SELECT id::text FROM consultants WHERE lower(email) = lower($1) AND is_active',
      [email],
    );
    return rows[0]?.id as string | undefined;
  }

  const notFound = (reply: FastifyReply) =>
    reply.code(404).send({ error: 'We could not find that appointment.' });

  type Req = { Params: { reference: string }; Querystring: { after?: string }; Body: { body: string } };

  // The same two endpoints serve both sides; only "who is this" differs.
  function register(path: string, preHandler: Parameters<typeof app.get>[1]['preHandler'], whoFor: (user: { sub: string; email: string }) => Promise<Party | undefined>) {
    app.get<Req>(path, { preHandler, schema: { params, querystring } }, async (request, reply) => {
      const who = await whoFor(request.user!);
      if (!who) return reply.code(404).send({ error: 'No consultant record for this sign-in' });
      const messages = await listMessages(pool, request.params.reference, who, request.query.after);
      return messages ?? notFound(reply);
    });

    app.post<Req>(path, { preHandler, config: { rateLimit: writeLimit }, schema: { params, body } }, async (request, reply) => {
      const who = await whoFor(request.user!);
      if (!who) return reply.code(404).send({ error: 'No consultant record for this sign-in' });
      const result = await sendMessage(pool, request.params.reference, who, request.body.body, now());
      if (result.ok) return reply.code(201).send(result.message);
      if (result.reason === 'not_found') return notFound(reply);
      return reply.code(409).send({ error: 'Messages can only be sent from 5 minutes before the start until 5 minutes after it.' });
    });
  }

  register('/appointments/:reference/messages', authenticate, async (user) => ({
    kind: 'client',
    clientId: user.sub,
  }));

  register('/staff/appointments/:reference/messages', [authenticate, requireRole('consultant')], async (user) => {
    const consultantId = await consultantIdFor(user.email);
    return consultantId ? { kind: 'consultant', consultantId } : undefined;
  });
};
