import fs from 'fs';
import path from 'path';

function checkImports(filePath: string, visited: Set<string> = new Set()) {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    if (!fs.existsSync(filePath)) {
        console.log(`❌ FILE NOT FOUND: ${filePath}`);
        return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const importRegex = /from\s+['"](.+?)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        let importPath = match[1];
        if (importPath.startsWith('.')) {
            let fullImportPath = path.resolve(path.dirname(filePath), importPath);

            // Handle .js -> .ts conversion for check
            if (fullImportPath.endsWith('.js')) {
                const tsPath = fullImportPath.replace(/\.js$/, '.ts');
                if (fs.existsSync(tsPath)) {
                    checkImports(tsPath, visited);
                } else {
                    console.log(`❌ IMPORT NOT FOUND: ${importPath} (expected ${tsPath}) in ${filePath}`);
                }
            } else if (importPath.endsWith('.json')) {
                if (!fs.existsSync(fullImportPath)) {
                    console.log(`❌ IMPORT NOT FOUND: ${importPath} in ${filePath}`);
                }
            } else {
                // Might be a directory index or missing extension
                console.log(`⚠️ AMBIGUOUS IMPORT: ${importPath} in ${filePath}`);
            }
        }
    }
}

console.log('Starting dependency check...');
checkImports(path.resolve(process.cwd(), 'src/server.ts'));
console.log('Check finished.');
