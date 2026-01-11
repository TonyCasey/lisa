function buildTags({ domain, level, lifecycle, language, tool, extra = [] } = {}) {
  const tags = [];
  if (domain) tags.push(`domain:${domain}`);
  if (level) tags.push(`level:${level}`);
  if (lifecycle) tags.push(`lifecycle:${lifecycle}`);
  if (language) tags.push(`language:${language}`);
  if (tool) tags.push(`tool:${tool}`);
  return tags.concat(extra);
}

module.exports = { buildTags };
