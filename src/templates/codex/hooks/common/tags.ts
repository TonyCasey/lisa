export {}; // mark module scope

function buildTags({
  domain,
  level,
  lifecycle,
  language,
  tool,
  extra = [],
}: {
  domain?: string;
  level?: string;
  lifecycle?: string;
  language?: string;
  tool?: string;
  extra?: string[];
} = {}) {
  const tags: string[] = [];
  if (domain) tags.push(`domain:${domain}`);
  if (level) tags.push(`level:${level}`);
  if (lifecycle) tags.push(`lifecycle:${lifecycle}`);
  if (language) tags.push(`language:${language}`);
  if (tool) tags.push(`tool:${tool}`);
  return tags.concat(extra);
}

module.exports = { buildTags };
