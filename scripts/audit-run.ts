import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRun } from '../src/trace/audit';
import { acceptanceCases, type AcceptanceCaseId } from '../src/contracts/acceptance';

const args = process.argv.slice(2);
const usage = '用法：npm run audit:run -- --run <运行UUID> [--case hud|move|negative|unknown|cancel]。只读，不调用模型或手柄，不修改记录。';
let runId = '', caseId: AcceptanceCaseId | undefined;
try {
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error(usage);
    if (args[i] === '--run' && !runId) runId = value;
    else if (args[i] === '--case' && !caseId && acceptanceCases.some(item => item.id === value)) caseId = value as AcceptanceCaseId;
    else throw new Error(usage);
  }
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(runId)) throw new Error(usage);
  const project = fileURLToPath(new URL('../', import.meta.url));
  const report = await auditRun(resolve(project, 'runs', runId), caseId);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.technicalPassed ? 0 : 1;
} catch { console.error(usage); process.exitCode = 2; }
