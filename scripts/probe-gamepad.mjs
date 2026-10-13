// Neutral-only real-driver probe: does not send movement or button actions.
import { PythonGamepad, findPython } from '../src/input/python-client.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const client = new PythonGamepad(findPython(process.cwd()), process.cwd() + '/dist/python/gamepad_service.py');
try {
  await client.start('virtual-xbox');
  const initial = await client.request('status');
  const reset = await client.reset();
  const result = { backend: 'virtual-xbox', actionCount: initial.appliedCount, startupNeutral: initial.neutral, resetNeutralAck: reset.neutral, resetAckMs: reset.cancelAckMs, gameInputMappingVerified: false, measuredScope: 'service ACK after vgamepad reset/update; no movement or button action' };
  if (initial.appliedCount !== 0 || initial.neutral !== true || reset.neutral !== true) throw new Error('Neutral driver probe failed');
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/input-driver-probe.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await client.dispose(); }
