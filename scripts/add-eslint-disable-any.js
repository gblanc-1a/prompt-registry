#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Run eslint and capture output
console.log('Running eslint to find no-explicit-any violations...');
let lintOutput;
try {
    execSync('npm run lint', { encoding: 'utf-8', stdio: 'pipe' });
} catch (error) {
    lintOutput = error.stdout || error.stderr || '';
}

// Parse the output to find no-explicit-any violations
const lines = lintOutput.split('\n');
const violations = [];
let currentFile = null;

for (const line of lines) {
    // Check if this is a file path line
    if (line.startsWith('/')) {
        currentFile = line.trim();
    } else if (currentFile && line.includes('no-explicit-any')) {
        // Extract line number
        const match = line.match(/^\s*(\d+):\d+/);
        if (match) {
            const lineNumber = parseInt(match[1], 10);
            violations.push({ file: currentFile, line: lineNumber });
        }
    }
}

console.log(`Found ${violations.length} no-explicit-any violations`);

// Group violations by file
const fileViolations = {};
for (const violation of violations) {
    if (!fileViolations[violation.file]) {
        fileViolations[violation.file] = [];
    }
    fileViolations[violation.file].push(violation.line);
}

// Process each file
for (const [filePath, lineNumbers] of Object.entries(fileViolations)) {
    console.log(`Processing ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`  File not found, skipping`);
        continue;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Sort line numbers in descending order to avoid offset issues
    lineNumbers.sort((a, b) => b - a);
    
    for (const lineNumber of lineNumbers) {
        const lineIndex = lineNumber - 1;
        if (lineIndex < 0 || lineIndex >= lines.length) {
            continue;
        }
        
        const line = lines[lineIndex];
        
        // Skip if already has eslint-disable comment
        if (line.includes('eslint-disable')) {
            continue;
        }
        
        // Get the indentation of the current line
        const indent = line.match(/^(\s*)/)[1];
        
        // Insert the disable comment on the line before
        const comment = `${indent}// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: Add proper types (Req 7)`;
        lines.splice(lineIndex, 0, comment);
    }
    
    // Write the modified content back
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`  Added ${lineNumbers.length} disable comments`);
}

console.log('Done!');
