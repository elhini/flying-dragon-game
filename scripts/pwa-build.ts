import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformWithOxc } from 'vite';
import type { Plugin } from 'vite';

async function publicFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await publicFiles(directory, `${name}/`));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported public asset: ${name}`);
  }
  return files;
}

export function offlineGame(): Plugin {
  let outputDirectory: string;
  let publicDirectory: string;
  return {
    name: 'offline-game',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
      publicDirectory = config.publicDir;
    },
    async writeBundle(_options, bundle) {
      const names = [...new Set([...Object.keys(bundle), ...await publicFiles(publicDirectory)])].sort();
      const entries = await Promise.all(names.map(async url => ({
        url,
        integrity: `sha384-${createHash('sha384').update(await readFile(resolve(outputDirectory, url))).digest('base64')}`,
      })));
      const source = await readFile(new URL('../worker/service-worker.ts', import.meta.url), 'utf8');
      const compiled = (await transformWithOxc(source, 'service-worker.ts', { target: 'es2023' })).code;
      // Worker logic changes also require a new cache, even if the assets are unchanged.
      const version = createHash('sha256').update(compiled).update(JSON.stringify(entries)).digest('hex').slice(0, 24);
      await writeFile(resolve(outputDirectory, 'sw.js'),
        `const VERSION = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(entries)};\n${compiled}`);
    },
  };
}
