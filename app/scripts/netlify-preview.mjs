// Netlify PR preview of THIS app branch only: publish the app's own pages (app/web) instead of the website,
// so the preview link shows the app on a phone. Runs inside Netlify's temporary build machine; the repository,
// hansora.co (production) and every other PR preview are unchanged.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const APP_BRANCHES = ['claude/great-franklin-3m5ffv'];
const branch = process.env.HEAD || process.env.BRANCH || '';
if (process.env.CONTEXT !== 'deploy-preview' || !APP_BRANCHES.includes(branch)) {
  console.log(`app preview: skipped (context=${process.env.CONTEXT || '-'}, branch=${branch || '-'})`);
  process.exit(0);
}
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
rmSync(join(repo, 'public'), { recursive: true, force: true });
cpSync(join(repo, 'app/web'), join(repo, 'public'), { recursive: true });
console.log('app preview: publishing app/web for this PR preview');
