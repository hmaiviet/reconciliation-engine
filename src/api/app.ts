import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ValidationError, type InputError } from '../domain/types.js';
import { runReconciliation } from '../pipeline.js';

export const BODY_LIMIT = 10 * 1024 * 1024;

const text = { type: 'string' } as const;
const bodySchema = {
  type: 'object',
  required: ['ours', 'theirs', 'manual', 'as_of'],
  additionalProperties: false,
  properties: {
    ours: text,
    theirs: text,
    manual: text,
    as_of: text,
    tolerances: { type: 'object', additionalProperties: false, properties: { amount: text, seconds: text } },
  },
} as const;

interface Body {
  ours: string;
  theirs: string;
  manual: string;
  as_of: string;
  tolerances?: { amount?: string; seconds?: string };
}

/** D8: POST /reconcile. Exported separately from listen() so tests can use inject(). */
export function buildApp({ logger = false } = {}): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: BODY_LIMIT,
    // Reject wrong types and unknown fields instead of Fastify's default of silently coercing or dropping them.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.setErrorHandler<FastifyError | ValidationError>((err, req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ errors: err.errors });
    if (err.validation) {
      const errors: InputError[] = err.validation.map((v) => {
        const prop = v.params.missingProperty ?? v.params.additionalProperty;
        const field = [...v.instancePath.split('/').slice(1), ...(prop ? [String(prop)] : [])].join('.');
        return { ...(field && { field }), message: v.message ?? 'invalid' };
      });
      return reply.code(400).send({ errors });
    }
    const status = err.statusCode ?? 500;
    if (status < 500) return reply.code(status).send({ errors: [{ message: err.message }] });
    req.log.error(err);
    return reply.code(500).send({ errors: [{ message: 'internal error' }] });
  });

  app.post<{ Body: Body }>('/reconcile', { schema: { body: bodySchema } }, async (req) => {
    const b = req.body;
    return runReconciliation({
      ours: { name: 'ours.csv', text: b.ours },
      theirs: { name: 'theirs.csv', text: b.theirs },
      manual: { name: 'manual.csv', text: b.manual },
      asOf: b.as_of,
      tolerances: b.tolerances,
    });
  });

  return app;
}
