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
    'file-types': '.vue,.js,.json,.yml',
    'output-file': 'combined_content.txt'
  }
});

// Extract values from parsed arguments
const directory = argv.path;
const fileTypes = argv['file-types'].split(',').map(ext => ext.trim());
const outputFile = argv['output-file'];

/**
 * Reads .llmignore from the specified directory and returns a filter function
 * that returns `true` if a file should NOT be ignored, and `false` if it should be ignored.
 */
function createGitignoreFilter(dir) {
  let gitignorePatterns = [];
  const llmignorePath = path.join(dir, '.llmignore');

  try {
    const gitignoreContent = fs.readFileSync(llmignorePath, 'utf8');
    gitignorePatterns = gitignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'));
  } catch (error) {
    console.warn(`No .llmignore file found or unable to read it at: ${llmignorePath}`);
  }

  return (filePath) => {
    // filePath is absolute, so create a relative path from the base directory
    const relativePath = path.relative(dir, filePath);
    
    // Check each pattern
    return !gitignorePatterns.some(pattern => {
      // If pattern ends with '/', it's a directory pattern
      if (pattern.endsWith('/')) {
        // e.g., "dist/" means ignore everything in dist/
        return (
          relativePath === pattern.slice(0, -1) ||
          relativePath.startsWith(pattern) ||
          relativePath.includes(`/${pattern}`)
        );
      }
      // Convert wildcard patterns like *.js or file?.js to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      return (
        regex.test(relativePath) ||
        relativePath.includes(`/${pattern}`)
      );
    });
  };
}

/**
 * Recursively collects files from a directory (and subdirectories),
 * filtering out those that match .llmignore and only including the specified file types.
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
        // Check if directory is not ignored before traversing
        if (gitignoreFilter(entryPath)) {
          traverseDir(entryPath);
        }
      } else {
        // Check file extension and ignore status
        if (fileTypes.includes(path.extname(entryPath)) && gitignoreFilter(entryPath)) {
          results.push(entryPath);
        }
      }
    }
  }

  traverseDir(dir);
  return results;
}

/**
 * Sort files alphabetically, grouping files from the same folder together.
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
 * Reads and concatenates files into a single output file,
 * with markers separating the start/end of each file.
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
 * Main function to coordinate argument parsing and file processing.
 */
async function main() {
  await processFiles(directory, fileTypes, outputFile);
  console.log(`Combined content written to ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
