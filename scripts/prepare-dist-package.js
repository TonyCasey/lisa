const fs = require('fs');
const path = require('path');

const rootPkgPath = path.resolve(__dirname, '..', 'package.json');
const distDir = path.resolve(__dirname, '..', 'dist');
const distPkgPath = path.join(distDir, 'package.json');

if (!fs.existsSync(distDir)) {
  throw new Error('dist/ not found; run `npm run build` first.');
}

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

const distPkg = {
  ...rootPkg,
  main: 'cli.js',
  bin: {
    remember: 'cli.js',
    'lisa': 'cli.js',
  },
  files: ['**/*'],
};

// Drop dev-only metadata to keep installs lean.
delete distPkg.devDependencies;
delete distPkg.scripts;

fs.writeFileSync(distPkgPath, `${JSON.stringify(distPkg, null, 2)}\n`, 'utf8');
