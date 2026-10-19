import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AuthConfig {
  issuer: string;
  audience: string;
  // Finds the public key that signed a token. In production this is the identity
  // provider's published key set (createRemoteJWKSet); tests supply their own key.
  getKey: JWTVerifyGetKey;
}

export interface AuthUser {
  sub: string; // the identity provider's stable id for this person
  email: string;
  name?: string;
  roles: string[]; // e.g. 'consultant', 'manager'; clients have none
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

function unauthorised(reply: FastifyReply, message: string) {
  return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: message });
}

// Fastify hook: put this in a route's preHandler to require a valid sign-in.
// It checks the signature, the issuer, the audience and the expiry of the token.
export function createAuthenticate(auth: AuthConfig) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return unauthorised(reply, 'Sign in required');

    try {
      const { payload } = await jwtVerify(header.slice('Bearer '.length), auth.getKey, {
        issuer: auth.issuer,
        audience: auth.audience,
        algorithms: ['RS256', 'ES256'],
      });

      if (!payload.sub || typeof payload.email !== 'string') {
        return unauthorised(reply, 'Token is missing the sign-in details we need');
      }

      const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
      request.user = {
        sub: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        roles: realmAccess?.roles ?? [],
      };
    } catch {
      // Expired, wrong signature, wrong issuer or audience, or not a token at all.
      // The reason is deliberately not sent back to the caller.
      return unauthorised(reply, 'Invalid or expired sign-in');
    }
  };
}

// Use after authenticate to limit a route to one role (for example 'consultant').
export function requireRole(role: string) {
  return async function checkRole(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user?.roles.includes(role)) {
      return reply.code(403).send({ error: 'You do not have access to this' });
    }
  };
}
