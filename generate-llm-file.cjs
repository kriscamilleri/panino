const fs = require('fs');
const path = require('path');

const outputFile = 'combined_content.txt';

// Function to read .llmignore and create a filter function
function createGitignoreFilter() {
    let gitignorePatterns = [];
    try {
        const gitignoreContent = fs.readFileSync('.llmignore', 'utf8');
        gitignorePatterns = gitignoreContent.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
    } catch (error) {
        console.warn('No .llmignore file found or unable to read it.');
    }

    return (filePath) => {
        const relativePath = path.relative(process.cwd(), filePath);
        return !gitignorePatterns.some(pattern => {
            // Handle directory patterns (ending with /)
            if (pattern.endsWith('/')) {
                return relativePath.startsWith(pattern) || relativePath.includes(`/${pattern}`);
            }
            // Handle wildcard patterns
            const regexPattern = pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.');
            return new RegExp(`^${regexPattern}$`).test(relativePath) || relativePath.includes(`/${pattern}`);
        });
    };
}

// Function to get all files recursively
function getFiles(dir, fileTypes) {
    const gitignoreFilter = createGitignoreFilter();
    const results = [];

    function traverseDir(currentPath) {
        const files = fs.readdirSync(currentPath);
        for (const file of files) {
            const filePath = path.join(currentPath, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                // Check if the directory should be ignored before traversing
                if (gitignoreFilter(filePath)) {
                    traverseDir(filePath);
                }
            } else if (fileTypes.includes(path.extname(file)) && gitignoreFilter(filePath)) {
                results.push(filePath);
            }
        }
    }

    traverseDir(dir);
    return results;
}

// Function to sort files alphabetically and keep files in the same folder adjacent
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

// Function to process files
async function processFiles(fileTypes) {
    const files = getFiles('.', fileTypes);
    const sortedFiles = sortFiles(files);

    // Clear the output file if it exists
    fs.writeFileSync(outputFile, '');

    for (const file of sortedFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const fileContent = `----- START: ${file} -----\n${content}\n----- END: ${file} -----\n\n`;
        fs.appendFileSync(outputFile, fileContent);
    }
}

// Main function
async function main() {
    const fileTypes = ['.vue', '.js', '.json'];
    await processFiles(fileTypes);
    console.log(`Combined content written to ${outputFile}`);
}

main().catch(console.error);