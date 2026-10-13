import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(process.env.PI_SOURCE_DIR || fileURLToPath(new URL('../../../../pi', import.meta.url)));
const pinned = '4270522473e677ddba7b093caa0064a3df51d459';
const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actual !== pinned) throw new Error(`Pi commit mismatch: expected ${pinned}, received ${actual}`);
await import(pathToFileURL(resolve(root, 'packages/coding-agent/src/experimental/source-resolver.ts')).href);
