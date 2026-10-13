import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeCampaign, nextAssignment, campaignReport, reviewTrial, recordChecklist, type Group } from '../src/benchmarks/campaign';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...args] = process.argv.slice(2);
const load = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'));
try {
  if (command === 'freeze' && args.length === 1) console.log(JSON.stringify({ campaignId: await freezeCampaign(root, await load(args[0])) }, null, 2));
  else if (command === 'next' && args.length === 1) console.log(JSON.stringify(await nextAssignment(root, args[0]), null, 2));
  else if (command === 'review' && args.length === 4) { await reviewTrial(root, args[0], args[1] as Group, Number(args[2]), await load(args[3])); console.log('人工复核已追加；不覆盖已有记录。'); }
  else if (command === 'check' && args.length === 3) { await recordChecklist(root, args[0], args[1], await load(args[2])); console.log('检查证据已保存。'); }
  else if (command === 'report' && (args.length === 1 || args.length === 2)) {
    const report = await campaignReport(root, args[0]);
    if (args[1]) await writeFile(resolve(args[1]), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'accepted' ? 0 : 1;
  } else throw new Error('用法：p4 freeze <配置.json> | next <批次UUID> | review <批次UUID> <组> <序号> <复核.json> | check <批次UUID> <检查项> <复核.json> | report <批次UUID> [新报告.json]');
} catch (error) { console.error(error instanceof Error ? error.message : 'P4 操作失败'); process.exitCode = 2; }
