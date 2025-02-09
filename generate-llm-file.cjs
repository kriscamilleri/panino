#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

// Parse command-line arguments
const argv = minimist(process.argv.slice(2), {
    string: ['path', 'file-types', 'output-file'],
    alias: {
        p: 'path',
        f: 'file-types',
        o: 'output-file'
    },
    default: {
        path: process.cwd(),
        'file-types': '.vue,.js,.json,.yml,.py,.txt,Dockerfile,.conf',
        'output-file': 'combined_content.txt'
    }
});

// Extract values from parsed arguments
const directory = argv.path;
const fileTypes = argv['file-types'].split(',').map(ext => ext.trim());
const outputFile = argv['output-file'];

/**
 * Convert a gitignore pattern to a regular expression
 */
function patternToRegExp(pattern) {
    let modifiedPattern = pattern;

    // Handle directory separator normalization
    modifiedPattern = modifiedPattern.replace(/\\/g, '/');

    // Handle directory-only patterns (ending with /)
    const dirOnly = pattern.endsWith('/');
    if (dirOnly) {
        modifiedPattern = modifiedPattern.slice(0, -1);
    }

    // Convert gitignore wildcards to regex
    modifiedPattern = modifiedPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '(.+)?')
        .replace(/\*/g, '[^/]+')
        .replace(/\?/g, '[^/]');

    // Build the complete regex pattern
    const regexPattern = `^${modifiedPattern}${dirOnly ? '(?:/.*)?$' : '$'}`;
    return new RegExp(regexPattern);
}

/**
 * Reads .llmignore from the specified directory and returns a filter function
 */
function createGitignoreFilter(dir) {
    let gitignorePatterns = [];
    const llmignorePath = path.join(dir, '.llmignore');

    try {
        const gitignoreContent = fs.readFileSync(llmignorePath, 'utf8');
        gitignorePatterns = gitignoreContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'))
            .map(pattern => ({
                pattern,
                regex: patternToRegExp(pattern)
            }));
    } catch (error) {
        console.warn(`No .llmignore file found or unable to read it at: ${llmignorePath}`);
    }

    return (filePath) => {
        // Convert to relative path and normalize separators
        const relativePath = path.relative(dir, filePath).replace(/\\/g, '/');

        // Check if the path should be ignored
        return !gitignorePatterns.some(({ pattern, regex }) => {
            // Special handling for node_modules
            if (pattern === 'node_modules' && relativePath.includes('node_modules')) {
                return true;
            }

            // Special handling for package-lock.json
            if (pattern === 'package-lock.json' && relativePath.endsWith('package-lock.json')) {
                return true;
            }

            return regex.test(relativePath);
        });
    };
}

/**
 * Recursively collects files from a directory
 */
function getFiles(dir, fileTypes) {
    const gitignoreFilter = createGitignoreFilter(dir);
    const results = [];

    function traverseDir(currentPath) {
        const entries = fs.readdirSync(currentPath);
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry);
            const stat = fs.statSync(entryPath);

            if (stat.isDirectory()) {
                // Skip if directory itself is ignored
                if (gitignoreFilter(entryPath)) {
                    traverseDir(entryPath);
                }
            } else {
                // Check file extension and ignore status
                const ext = path.extname(entryPath);
                if (fileTypes.includes(ext) && gitignoreFilter(entryPath)) {
                    results.push(entryPath);
                }

                // check if file doesn't have an extension (ex in cases like Dockerfile)
                const filename = path.basename(entryPath);
                if (ext === '' && fileTypes.includes(filename) && gitignoreFilter(entryPath)) {
                    results.push(entryPath);
                }
            }
        }
    }

    traverseDir(dir);
    return results;
}

/**
 * Sort files alphabetically, grouping files from the same folder together
 */
function sortFiles(files) {
    return files.sort((a, b) => {
        const dirA = path.dirname(a);
        const dirB = path.dirname(b);

        if (dirA === dirB) {
            return a.localeCompare(b);
        }
        return dirA.localeCompare(dirB);
    });
}

/**
 * Reads and concatenates files into a single output file
 */
async function processFiles(dir, fileTypes, outputPath) {
    // Gather and sort files
    const files = getFiles(dir, fileTypes);
    const sortedFiles = sortFiles(files);

    // Clear the output file if it exists
    fs.writeFileSync(outputPath, '');

    for (const file of sortedFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const fileContent = `----- START: ${file} -----\n${content}\n----- END: ${file} -----\n\n`;
        fs.appendFileSync(outputPath, fileContent);
    }
}

/**
 * Main function to coordinate argument parsing and file processing
 */
async function main() {
    await processFiles(directory, fileTypes, outputFile);
    console.log(`Combined content written to ${outputFile}`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});