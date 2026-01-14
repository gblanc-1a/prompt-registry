#!/usr/bin/env node
const { listCollectionFiles, readCollection, resolveCollectionItemPaths } = require('./lib/collections');

function parseArgs(argv) {
  const out = { changedPaths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--changed-path' && argv[i + 1]) {
      out.changedPaths.push(argv[i + 1]);
      i++;
    }
  }
  return out;
}

function normalizeRepoRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\//, '');
}

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));

const changed = new Set(args.changedPaths.map(normalizeRepoRel));

const files = listCollectionFiles(repoRoot);
const affected = [];

files.forEach(file => {
  const collection = readCollection(repoRoot, file);
  const itemPaths = new Set(resolveCollectionItemPaths(repoRoot, collection).map(normalizeRepoRel));

  const collectionFileRel = normalizeRepoRel(file);
  const touchesCollection = changed.has(collectionFileRel);
  const touchesItem = [...changed].some(p => itemPaths.has(p));

  if (touchesCollection || touchesItem) {
    affected.push({ id: collection.id, file, reason: touchesCollection ? 'collection-file' : 'referenced-file' });
  }
});

process.stdout.write(JSON.stringify({ affected }, null, 2) + '\n');
