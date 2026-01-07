#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { listCollectionFiles } = require('./lib/collections');
const { validateCollectionFile } = require('./lib/validate');

function parseArgs(argv) {
    const out = { verbose: false, collectionFiles: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--verbose') out.verbose = true;
        else if (arg === '--collection-file' && argv[i + 1]) {
            out.collectionFiles.push(argv[i + 1]);
            i++;
        }
    }
    return out;
}

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));

const collectionsDir = path.join(repoRoot, 'collections');
if (!fs.existsSync(collectionsDir)) {
    console.error('❌ collections/ directory not found');
    process.exit(1);
}

const files = args.collectionFiles.length > 0 ? args.collectionFiles : listCollectionFiles(repoRoot);
console.log(`Found ${files.length} collection(s)`);

let hasErrors = false;
files.forEach(file => {
    const result = validateCollectionFile(repoRoot, file);
    if (!result.ok) {
        hasErrors = true;
        console.error(`❌ ${file}: invalid`);
        result.errors.forEach(e => console.error(`  - ${e}`));
    } else if (args.verbose) {
        console.log(`✓ ${file}: valid`);
    }
});

process.exit(hasErrors ? 1 : 0);
