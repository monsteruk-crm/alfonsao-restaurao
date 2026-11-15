import { config } from 'dotenv';
import { experimental_getVideoStatus as getVideoStatus } from 'ai';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { sanitize } from './diagnostics.js';
config({ quiet: true });
process.env.AI_GATEWAY_API_KEY ||= process.env.VERCEL_API_KEY;

async function main() {
  const { values } = parseArgs({ options: { run: { type: 'string' }, watch: { type: 'boolean' } } });
  if (!values.run) throw new Error('Usage: npm run status -- --run outputs/RUN-DIRECTORY [--watch]');
  const root = path.resolve(values.run);
  async function exists(file: string) { try { await stat(file); return true; } catch { return false; } }
  do {
    const entries = await readdir(root, { withFileTypes: true });
    const chunks = entries.filter(e => e.isDirectory() && /^chunk-\d+$/.test(e.name)).map(e => e.name).sort();
    const settings = JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8'));
    const expected = settings.chunks?.length ?? 1;
    const directories = chunks.length ? chunks.map(c => path.join(root, c)) : [root];
    let completed = 0, active = false;
    console.log(`\n${new Date().toISOString()} — ${path.basename(root)}`);
    const pauseFile = path.join(root, 'run-status.json');
    const pause = await exists(pauseFile) ? JSON.parse(await readFile(pauseFile, 'utf8')) : undefined;
    if (pause) console.log(`Run state: ${pause.status}; ${pause.message ?? ''}`);
    for (const directory of directories) {
      const label = path.basename(directory);
      if (await exists(path.join(directory, 'restored.mp4'))) { completed++; console.log(`${label}: output saved`); continue; }
      const jobFile = path.join(directory, 'job.json');
      if (!(await exists(jobFile))) {
        if (pause?.status === 'paused-for-credits' && pause.stoppedBeforeChunk === label) console.log(`${label}: paused for insufficient credits; no completed output`);
        else { console.log(`${label}: preparing/uploading, or no saved job reference`); active = true; }
        continue;
      }
      const job = JSON.parse(await readFile(jobFile, 'utf8'));
      const status = await getVideoStatus(job.model, { operation: job.operation,
        maxRetries: 0, abortSignal: AbortSignal.timeout(30_000) });
      const meta: any = status.providerMetadata;
      const gateway = meta?.gateway?.asyncJob;
      const elapsed = job.submittedAt ? `${Math.round((Date.now() - Date.parse(job.submittedAt)) / 1000)}s since submission` : '';
      console.log(`${label}: Gateway=${gateway?.status ?? status.status}; status check=OK; ${elapsed}; job=${gateway?.jobId ?? job.jobId ?? '—'}`);
      if (status.status === 'pending') active = true;
      if (status.status === 'error') console.log(`  Provider error: ${JSON.stringify(sanitize(status.error))}`);
      if (status.status === 'completed') console.log('  Provider completed; generation process may still be downloading or verifying.');
      console.log(`  Provider diagnostics: ${JSON.stringify(sanitize(meta))}`);
    }
    console.log(`Outputs saved: ${completed}/${expected}; final movie: ${await exists(path.join(root, 'restored.mp4')) ? 'saved' : 'not saved yet'}.`);
    console.log('No render percentage or ETA is available unless explicitly supplied by the provider. This command never starts or cancels a generation.');
    if (!values.watch || !active || pause?.status === 'paused-for-credits') return;
    await delay(15_000);
  } while (true);
}
main().catch(error => { console.error(`Status check failed: ${sanitize(error instanceof Error ? error.message : String(error))}`); process.exitCode = 1; });
