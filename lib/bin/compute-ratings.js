#!/usr/bin/env node
const { computeRatings } = require('../dist/compute-ratings');

function getArg(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const eqArg = args.find((a) => a.startsWith(`--${name}=`));
  return eqArg ? eqArg.substring(`--${name}=`.length) : undefined;
}

const repo = getArg('repo');
const category = getArg('category') || 'Bundle Ratings';
const output = getArg('output') || 'ratings.json';
const token = process.env.GITHUB_TOKEN;

if (!repo || !token) {
  console.error('Usage: GITHUB_TOKEN=<token> compute-ratings --repo owner/repo [--output ratings.json] [--category "Bundle Ratings"]');
  process.exit(1);
}

computeRatings({ repo, category, outputPath: output, token })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('compute-ratings failed:', err.message);
    process.exit(1);
  });
