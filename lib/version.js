// Single runtime source for the package version, read from package.json so the
// health endpoints never drift from the published version.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
export const VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
