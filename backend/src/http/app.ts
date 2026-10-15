import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError, type Deps, type RequestContext } from '../application/core';
import { buildContext } from '../application/organizations';
import { registerRoutes } from './routes';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

export function createApp(deps: Deps, opts: { allowedOrigins?: string[] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run / Firebase Hosting front end
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || !opts.allowedOrigins?.length || opts.allowedOrigins.includes(origin)),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '3mb' }));

  // Structured request log (Cloud Logging parses JSON lines). Never logs bodies or document content.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (deps.config.env === 'test') return;
      console.log(JSON.stringify({ severity: res.statusCode >= 500 ? 'ERROR' : 'INFO', message: 'request', method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, uid: req.ctx?.uid ?? null, org: req.ctx?.organizationId ?? null }));
    });
    next();
  });

  const limiter = rateLimit({ windowMs: 60_000, limit: deps.config.env === 'test' ? 10_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false });
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: deps.config.env === 'test' ? 10_000 : 30, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api/', limiter);
  app.use('/api/v1/shared', publicLimiter);
  app.use('/api/v1/invites', publicLimiter);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: deps.config.maxUploadBytes, files: 1 } });

  const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const h = req.header('authorization');
      if (!h?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
      req.ctx = await buildContext(deps, h.slice(7));
      next();
    } catch (e) {
      next(e);
    }
  };

  registerRoutes(app, deps, { authenticate, upload });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    if (deps.config.env !== 'test') console.error(JSON.stringify({ severity: 'ERROR', message: 'unhandled', path: req.path, error: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 5).join(' | ') }));
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });
  return app;
}
