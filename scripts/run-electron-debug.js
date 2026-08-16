const { spawn } = require('child_process');
const { createWriteStream, mkdirSync } = require('fs');
const { join } = require('path');

const repo = __dirname + '/..';
const outDir = join(repo, 'out');
try { mkdirSync(outDir, { recursive: true }); } catch (e) {}
const logPath = join(outDir, 'electron-debug.log');
const out = createWriteStream(logPath, { flags: 'a' });

console.log('Launching electron, logging to', logPath);
const env = Object.assign({}, process.env, {
  ELECTRON_ENABLE_LOGGING: '1',
  ELECTRON_ENABLE_STACK_DUMPING: '1',
  DEBUG: '*'
});

const electronCmd = process.platform === 'win32' ? join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd') : join(__dirname, '..', 'node_modules', '.bin', 'electron');

const child = spawn(electronCmd, ['out/main/index.js'], { env, cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(out);
child.stderr.pipe(out);

child.on('error', (e) => {
  console.error('spawn error', e);
});
child.on('exit', (code, sig) => {
  console.log('electron exited', code, sig);
  out.end();
});

// Let it run for 20 seconds to collect logs then terminate
setTimeout(() => {
  try {
    child.kill('SIGTERM');
  } catch (e) {
    // ignore
  }
}, 20_000);
