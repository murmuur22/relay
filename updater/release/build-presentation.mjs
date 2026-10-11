// Build first-party UI a second time with exact-version asset URLs. No plugin loading.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['updater/ui/node_modules/vite/bin/vite.js', 'build', 'updater/ui', '--config', 'updater/ui/vite.config.js', '--mode', 'presentation']);
run('python3', ['-m', 'updater.release.presentation', '--dist', 'updater/ui/presentation-dist', '--version', `v${version}`]);
