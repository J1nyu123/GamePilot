import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditApproach } from '../src/trace/approach-audit';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--run' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args[1])) {
  console.error('用法：npm run audit:p3 -- --run <运行UUID>；只读，不发送输入或模型请求'); process.exitCode = 2;
} else {
  const report = await auditApproach(resolve(fileURLToPath(new URL('../', import.meta.url)), 'runs', args[1]));
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.technicalPassed ? 0 : 1;
}
