import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const sibling = resolve('../GamePilot-input-test/.venv/Scripts/python.exe');
const python = process.env.GAMEPAD_PYTHON || (existsSync(sibling) ? sibling : 'python');
const child = spawn(python, ['-m', 'unittest', 'discover', '-s', 'python', '-p', 'test_*.py', '-v'], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
