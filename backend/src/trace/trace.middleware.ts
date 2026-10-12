import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { redact, TraceService } from './trace.service';

/** Tags every request with an id, then records method/path/status/duration (and a redacted body) when it finishes. */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private trace: TraceService) {}
  use(req: any, res: any, next: () => void) {
    const id = String(req.headers['x-request-id'] ?? randomUUID().slice(0, 8)).slice(0, 64);
    const path: string = req.originalUrl ?? req.url;
    res.setHeader('x-request-id', id);
    req.traceId = id;
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (path.startsWith('/api/debug')) return; // the viewer polling itself would drown the log
      this.trace.request({ id, method: req.method, path, status: res.statusCode, durationMs: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), requestBody: redact(req.body) });
    });
    next();
  }
}
