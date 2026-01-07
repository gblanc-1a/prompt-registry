#!/usr/bin/env node
/**
 * Extract collection file paths from detect-affected-collections.js JSON output.
 * Used by pre-commit hook to avoid inline JavaScript in bash.
 *
 * Usage: echo '{"affected":[{"file":"collections/a.yml"}]}' | node scripts/extract-affected-files.js
 * Output: collections/a.yml (one file per line)
 */
const fs = require('node:fs');

const input = fs.readFileSync(0, 'utf8');

try {
  const data = JSON.parse(input);
  const files = (data.affected || []).map(a => a.file).filter(Boolean);
  if (files.length > 0) {
    console.log(files.join('\n'));
  }
} catch (e) {
  console.error(`Failed to parse JSON: ${e.message}`);
  process.exit(1);
}
