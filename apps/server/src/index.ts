import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import { createAPI } from '@repo/api/server';
import { createAuth } from '@repo/auth/server';
import { createDatabaseClient } from '@repo/db/client';
import { env } from '@repo/env';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const wildcardPath = {
  ALL: '*',
  BETTER_AUTH: '/api/auth/*',
  TRPC: '/trpc/*',
} as const;

const db = createDatabaseClient({ databaseUrl: env.DATABASE_URL });
const auth = createAuth({ db, webUrl: env.PUBLIC_WEB_URL });
const { trpcRouter, createContext } = createAPI({ auth, db });

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

app.use(logger());

app.use(
  wildcardPath.BETTER_AUTH,
  cors({
    origin: [env.PUBLIC_WEB_URL],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
  }),
);

app.use(
  wildcardPath.TRPC,
  cors({
    origin: [env.PUBLIC_WEB_URL],
    credentials: true,
  }),
);

app.use(wildcardPath.ALL, async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', session?.user ?? null);
  c.set('session', session?.session ?? null);
  return next();
});

app.on(['POST', 'GET'], wildcardPath.BETTER_AUTH, (c) =>
  auth.handler(c.req.raw),
);

app.use(
  wildcardPath.TRPC,
  trpcServer({
    router: trpcRouter,
    createContext: (c) => createContext({ headers: c.req.headers }),
  }),
);

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.get('/healthcheck', (c) => {
  return c.text('OK');
});

serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
    hostname: env.API_HOST,
  },
  (info) => {
    const host = info.family === 'IPv6' ? `[${info.address}]` : info.address;
    console.log(`Hono internal server: http://${host}:${info.port}`);
  },
);
