const j = require('./all.json');

// Group by date and find significant facts
const byDate = {};
for (const f of j.facts) {
  let date = 'unknown';
  try { date = new Date(f.created_at).toISOString().split('T')[0]; } catch(e) {}
  if (date === 'unknown') continue;
  if (!byDate[date]) byDate[date] = [];
  byDate[date].push(f.fact);
}

// Show summary by date
const dates = Object.keys(byDate).sort();
for (const d of dates) {
  console.log('=== ' + d + ' (' + byDate[d].length + ' memories) ===');
  // Show facts that mention release, feature, milestone, created, etc.
  const interesting = byDate[d].filter(f =>
    f.includes('release') || f.includes('v1.') || f.includes('FEATURE') ||
    f.includes('milestone') || f.includes('created') || f.includes('Created') ||
    f.includes('hook') || f.includes('implemented') || f.includes('introduced') ||
    f.includes('Added') || f.includes('new skill') || f.includes('summarization')
  );
  const unique = [...new Set(interesting)];
  for (const fact of unique.slice(0, 10)) {
    console.log('  - ' + fact.substring(0, 160));
  }
  if (unique.length > 10) console.log('  ... and ' + (unique.length - 10) + ' more');
  console.log('');
}
