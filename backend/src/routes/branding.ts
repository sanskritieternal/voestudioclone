import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';

/** Serves tenant branding assets: GET /api/branding/:asset (e.g. logo_dark.png). */
export default async function brandingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:asset', async (req, reply) => {
    const { asset } = req.params as { asset: string };
    if (!/^[a-zA-Z0-9._-]+$/.test(asset)) return reply.code(400).send({ error: 'bad_asset' });
    const file = path.join(config.artifactDir, 'branding', asset);
    try {
      await fs.access(file);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile(path.join('branding', asset), config.artifactDir);
  });
}
