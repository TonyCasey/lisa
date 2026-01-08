const path = require('path');
const { execSync } = require('child_process');

function detectRepo() {
  return path.basename(process.cwd());
}

function detectBranch() {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim();
  } catch (err) {
    return null;
  }
}

function repoTags({ repo, branch } = {}) {
  const tags = [];
  if (repo) tags.push(`repo:${repo}`);
  if (branch) tags.push(`branch:${branch}`);
  return tags;
}

module.exports = { detectRepo, detectBranch, repoTags };
