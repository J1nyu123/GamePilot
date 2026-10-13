import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validate } from './runtime.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help') || !option('--image')) {
  console.log('npm start -- --image <PNG/JPEG path> --prompt "Observe this image and simulate moving left for 200 ms"\nEnvironment: GAMEPILOT_BASE_URL, GAMEPILOT_MODEL, GAMEPILOT_API_KEY. Optional: --timeout-ms 30000');
  process.exit(args.includes('--help') ? 0 : 1);
}
const baseUrl = process.env.GAMEPILOT_BASE_URL, modelId = process.env.GAMEPILOT_MODEL, apiKey = process.env.GAMEPILOT_API_KEY;
if (!baseUrl || !modelId || !apiKey) throw new Error('Set GAMEPILOT_BASE_URL, GAMEPILOT_MODEL and GAMEPILOT_API_KEY locally. Never paste keys into chat.');
const url = new URL(baseUrl);
if (url.username || url.password || url.search) throw new Error('Endpoint must not contain credentials or query parameters');
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for remote endpoints');
const timeoutMs = Number(option('--timeout-ms') || 30000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw new Error('timeout-ms must be 100–300000');
const imagePath = resolve(option('--image'));
const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(imagePath).toLowerCase()];
if (!mimeType) throw new Error('Only PNG/JPEG supported');
const bytes = await readFile(imagePath);
if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Image must be 1 byte–10 MiB');
const taskId = randomUUID(), runDir = resolve('runs', taskId);
await mkdir(runDir, { recursive: true });
const prompt = option('--prompt') || 'Describe the screenshot briefly, then simulate moving left for 200 ms.';
await writeFile(resolve(runDir, 'manifest.json'), JSON.stringify({ taskId, startedAt: Date.now(), modelId, baseUrl, imagePath, prompt, simulated: true, piCommit: '4270522473e677ddba7b093caa0064a3df51d459', costTracking: 'disabled', contextWindow: 'configured placeholder' }, null, 2));
await writeFile(resolve(runDir, `input${extname(imagePath)}`), bytes);
let queue = Promise.resolve();
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
try {
  const summary = await validate({ baseUrl, modelId, apiKey, prompt, timeoutMs, signal: controller.signal,
    image: { type: 'image', data: bytes.toString('base64'), mimeType },
    onEvent(event) {
      // Redact exact credential even if a remote error happens to echo it.
      const line = JSON.stringify({ taskId, ...event }).split(apiKey).join('[REDACTED]');
      console.log(line);
      queue = queue.then(() => appendFile(resolve(runDir, 'events.jsonl'), `${line}\n`));
    },
  });
  await queue;
  await writeFile(resolve(runDir, 'summary.json'), JSON.stringify(summary, null, 2).split(apiKey).join('[REDACTED]'));
  console.log(`Trace: ${runDir}`);
  process.exitCode = summary.status === 'protocol_passed' ? 0 : 1;
} finally { process.removeListener('SIGINT', stop); }
