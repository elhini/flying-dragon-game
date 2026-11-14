import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export async function releaseServer(versions: { first: string; second: string }) {
  let version: keyof typeof versions = 'first';
  let unavailable: string | null = null;
  const pinned = new Map<string, keyof typeof versions>();
  const types: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', ico: 'image/x-icon', webmanifest: 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Test-Method', request.method!);
    response.setHeader('X-Test-Version', version);
    if (path === '/parent-sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));');
      return;
    }
    if (!path.startsWith('/game/')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Neighbor</title>Another application');
      return;
    }
    const name = decodeURIComponent(path.slice('/game/'.length)) || 'index.html';
    const root = resolve(versions[pinned.get(name) ?? version]);
    const target = resolve(root, name);
    if (!target.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if (name === unavailable) { response.writeHead(503).end('Temporarily unavailable'); return; }
    try {
      const content = await readFile(target);
      response.setHeader('Content-Type', types[name.split('.').at(-1)!] || 'application/octet-stream');
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    url: `${origin}/game/`,
    publish(): void { version = 'second'; },
    fail(name: string | null): void { unavailable = name; },
    pin(name: string, release: keyof typeof versions | null): void {
      if (release === null) pinned.delete(name); else pinned.set(name, release);
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
