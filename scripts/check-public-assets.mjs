import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const css = readFileSync(path.join(root, 'styles/fonts.css'), 'utf8');
const fontPaths = [...new Set([...css.matchAll(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g)].map(match => match[1]))];
const missing = fontPaths.filter(url => !existsSync(path.join(root, 'public', url)));
if (missing.length) {
    console.error('Build stopped: local font assets are missing from the deployment source.');
    console.error(missing.join('\n'));
    console.error('For a sparse Git checkout, run: git sparse-checkout add public/fonts');
    process.exitCode = 1;
} else {
    console.log(`Public font assets verified: ${fontPaths.length} files.`);
}
