import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const dist = resolve(process.env.FRONTEND_DIST ?? join(__dirname, '..', '..', 'frontend', 'dist'));
  if (existsSync(join(dist, 'index.html'))) {
    app.useStaticAssets(dist);
    // SPA fallback for client-side routes (anything that is not /api)
    app.use((req: any, res: any, next: () => void) =>
      req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(join(dist, 'index.html')) : next());
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1'); // local-only
  console.log(`Agent Evals ready on http://localhost:${port}`);
}
bootstrap();
