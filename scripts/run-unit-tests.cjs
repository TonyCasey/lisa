const { spawnSync } = require('child_process');
const { globSync } = require('glob');

const testFiles = globSync('tests/unit/**/*.test.ts', { nodir: true });

if (!testFiles.length) {
  console.error('No unit test files found under tests/unit.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
