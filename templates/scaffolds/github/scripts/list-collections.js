#!/usr/bin/env node
const path = require('path');
const { listCollectionFiles, readCollection } = require('./lib/collections');

const repoRoot = process.cwd();
const files = listCollectionFiles(repoRoot);

const result = files.map(f => {
  const c = readCollection(repoRoot, f);
  return { id: c.id, file: f, name: c.name };
});

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
