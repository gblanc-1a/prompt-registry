#!/usr/bin/env node
const { listCollectionFiles, readCollection, resolveCollectionItemPaths } = require('./lib/collections');

function parseArgs(argv) {
  const out = { collectionFile: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--collection-file' && argv[i + 1]) {
      out.collectionFile = argv[i + 1];
      i++;
    }
  }
  return out;
}

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));

const files = args.collectionFile ? [args.collectionFile] : listCollectionFiles(repoRoot);
const out = {};

files.forEach(f => {
  const c = readCollection(repoRoot, f);
  out[c.id] = {
    file: f,
    name: c.name,
    itemPaths: resolveCollectionItemPaths(repoRoot, c),
  };
});

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
