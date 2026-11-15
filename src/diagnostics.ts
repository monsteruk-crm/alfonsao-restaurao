import { appendFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Never persist credentials, uploaded bytes, result bytes, or signed download URLs.
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[nested]';
  if (typeof value === 'string') {
    for (const secret of [process.env.AI_GATEWAY_API_KEY, process.env.VERCEL_API_KEY, process.env.BLOB_READ_WRITE_TOKEN]) {
      if (secret) value = (value as string).replaceAll(secret, '[redacted]');
    }
    return (value as string).startsWith('http') ? '[url omitted]' : (value as string).slice(0, 500);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/secret|token|authorization|api.?key|videos|base64|inputReferences|prompt|headers/i.test(key))
    .map(([key, val]) => [key, sanitize(val, depth + 1)]));
  return value;
}

export class Diagnostics {
  state: Record<string, any>;
  private writes = Promise.resolve();
  constructor(private directory: string, model: string) {
    this.state = { model, stage: 'preparing', startedAt: new Date().toISOString(), pollCount: 0 };
  }
  update(values: Record<string, unknown>) {
    Object.assign(this.state, values, { updatedAt: new Date().toISOString() });
    const snapshot = JSON.stringify(this.state, null, 2);
    const event = JSON.stringify({ at: this.state.updatedAt, ...values });
    this.writes = this.writes.then(async () => {
      const temporary = path.join(this.directory, 'diagnostics.json.partial');
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, path.join(this.directory, 'diagnostics.json'));
      await appendFile(path.join(this.directory, 'events.jsonl'), event + '\n', { mode: 0o600 });
    });
    return this.writes;
  }
  async observe(endpoint: string, response: Response) {
    const poll = endpoint.endsWith('/status');
    await this.update({ lastHttpStatus: response.status, lastResponseAt: new Date().toISOString(),
      endpoint: poll ? 'status' : 'start', ...(poll ? { pollCount: this.state.pollCount + 1 } : {}) });
    // A completed inline result can be enormous. Bound diagnostic parsing to 1 MiB.
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) { void reader.cancel(); return; }
      text += decoder.decode(part.value, { stream: true });
    }
    let payload: any;
    try { payload = JSON.parse(text); } catch { return; }
    const job = payload.providerMetadata?.gateway?.asyncJob;
    if (!poll && payload.operation) {
      await writeFile(path.join(this.directory, 'job.json'), JSON.stringify({
        model: this.state.model, operation: payload.operation,
        jobId: job?.jobId, submittedAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 });
    }
    await this.update({ stage: response.ok ? 'provider-processing' : 'gateway-error',
      gatewayStatus: job?.status ?? payload.status ?? (response.ok ? 'accepted' : 'error'),
      ...(job?.jobId ? { jobId: job.jobId } : {}),
      providerMetadata: sanitize(payload.providerMetadata),
      ...(payload.error ? { gatewayError: sanitize(payload.error) } : {}),
    });
  }
  summary() {
    const s = this.state;
    const age = s.lastResponseAt ? `${Math.round((Date.now() - Date.parse(s.lastResponseAt)) / 1000)}s ago` : 'none yet';
    return `stage=${s.stage}; Gateway=${s.gatewayStatus ?? 'awaiting response'}; polls=${s.pollCount}; HTTP=${s.lastHttpStatus ?? '—'}; last response=${age}; job=${s.jobId ?? 'awaiting ID'}`;
  }
}
