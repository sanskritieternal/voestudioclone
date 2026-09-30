import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { promises as fs } from 'node:fs';
import { config } from './config';
import { authedLimiter } from './middleware/rateLimit';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import jobRoutes from './routes/jobs';
import toolRoutes from './routes/tools';
import voiceRoutes from './routes/voices';
import planRoutes from './routes/plans';
import brandingRoutes from './routes/branding';
import spendRoutes from './routes/spend';
import providerRoutes from './routes/providers';
import youtubeRoutes from './routes/youtube';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(fastifyJwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 25, fields: 20 } });

  app.decorate('authenticate', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    await authedLimiter(req, reply);
  });

  await fs.mkdir(config.artifactDir, { recursive: true });
  await app.register(fastifyStatic, { root: config.artifactDir, prefix: '/artifacts/' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'validation', details: err.validation });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    reply.code(500).send({ error: 'internal' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });
  await app.register(toolRoutes, { prefix: '/api/tools' });
  await app.register(voiceRoutes, { prefix: '/api/voices' });
  await app.register(planRoutes, { prefix: '/api/plans' });
  await app.register(brandingRoutes, { prefix: '/api/branding' });
  await app.register(spendRoutes, { prefix: '/api/spend' });
  await app.register(providerRoutes, { prefix: '/api/providers' });
  await app.register(youtubeRoutes, { prefix: '/api/youtube' });

  return app;
}
