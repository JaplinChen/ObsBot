import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GUARDIAN_DASHBOARD_HTML } from './dashboard-html.js';
import type { GuardianServiceManager } from './service.js';

export function createGuardianApiServer(manager: GuardianServiceManager, port: number) {
  const server = createServer(async (req, res) => {
    await handleRequest(manager, req, res);
  });
  return {
    start() {
      return new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
    },
    stop() {
      return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function handleRequest(
  manager: GuardianServiceManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  if (method === 'GET' && url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(GUARDIAN_DASHBOARD_HTML);
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (method === 'GET' && url === '/api/guardian/status') {
    res.end(JSON.stringify(manager.getSnapshot()));
    return;
  }

  if (method === 'POST' && url.startsWith('/api/guardian/actions/restart/')) {
    const serviceId = url.split('/').at(-1) ?? '';
    const ok = await manager.restartNow(serviceId);
    res.statusCode = ok ? 200 : 404;
    res.end(JSON.stringify({ ok }));
    return;
  }

  if (method === 'POST' && url.startsWith('/api/guardian/actions/pause/')) {
    const serviceId = url.split('/').at(-1) ?? '';
    const ok = await manager.updatePause(serviceId, true);
    res.statusCode = ok ? 200 : 404;
    res.end(JSON.stringify({ ok }));
    return;
  }

  if (method === 'POST' && url.startsWith('/api/guardian/actions/resume/')) {
    const serviceId = url.split('/').at(-1) ?? '';
    const ok = await manager.updatePause(serviceId, false);
    res.statusCode = ok ? 200 : 404;
    res.end(JSON.stringify({ ok }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}
