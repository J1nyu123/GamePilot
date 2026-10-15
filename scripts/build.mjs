import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, copyFile } from 'node:fs/promises';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const piRoot = resolve(process.env.PI_SOURCE_DIR || resolve(root, '../pi'));
const pinned = '4270522473e677ddba7b093caa0064a3df51d459';
export async function buildHost() {
  await mkdir(resolve(root, 'dist/capture'), { recursive: true });
  for (const asset of ['capture.html', 'native-window.ps1']) await copyFile(resolve(root, 'src/capture', asset), resolve(root, 'dist/capture', asset));
  await copyFile(resolve(root, 'src/input/windows-keyboard.ps1'), resolve(root, 'dist/capture/windows-keyboard.ps1'));
  await copyFile(resolve(root, 'src/input/virtual-gamepad.py'), resolve(root, 'dist/capture/virtual-gamepad.py'));
  if (execFileSync('git', ['-C', piRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== pinned) throw new Error('Pi source commit mismatch');
  const paths = JSON.parse(await readFile(resolve(piRoot, 'tsconfig.json'), 'utf8')).compilerOptions.paths;
  const piPlugin = { name: 'pinned-pi-source', setup(builder) {
    builder.onResolve({ filter: /^@earendil-works\// }, args => {
      const exact = paths[args.path]?.[0];
      if (exact) return { path: resolve(piRoot, exact) };
      if (args.path.startsWith('@earendil-works/pi-ai/')) return { path: resolve(piRoot, 'packages/ai/src', args.path.slice('@earendil-works/pi-ai/'.length) + '.ts') };
      throw new Error(`Unmapped Pi import: ${args.path}`);
    });
  } };
  await build({ entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'dist/main/index.mjs'),
    bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['electron'], plugins: [piPlugin],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, sourcemap: true });
  await build({ entryPoints: [resolve(root, 'src/preload/index.ts')], outfile: resolve(root, 'dist/preload/index.cjs'),
    bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'] });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await buildHost(); await viteBuild(); }
