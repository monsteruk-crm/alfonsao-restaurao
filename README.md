# Proteus video restoration

## Scene-based workflow (recommended)

This separates local scene preparation, paid processing, and local assembly. Settings are shared in `src/settings.ts`.

### 1. Detect cuts and create separate clips locally

```bash
npm run scenes:split -- --input "videos/The men in down - l'ultimo bonifico.mp4" --start 0 --end 1134 --max-seconds 15 --threshold 0.3 --reuse-run outputs/The_men_in_down_-_l_ultimo_bonifico-0-1134-U12gpY
```

The command prints its new queue directory under `outputs/scenes/`. Optional `--queue NEW-DIR` selects a new directory explicitly; existing directories are never overwritten. This step never calls Blob or AI Gateway. It creates a lossless H.264 CFR master, copying the selected source soundtrack; detects cuts using FFmpeg's `scene` score; splits in one video pass at exact frame boundaries; and creates independently playable clips with matching audio.

`--threshold` is between 0 and 1 (default 0.3). Lower values detect more changes; flashes, camera movement and fades can cause extra/missed cuts. Inspect `scenes.csv`, `cuts.json`, and the actual files in `clips/` before processing. Detected long scenes are subdivided into balanced clips capped at `--max-seconds` (default 15), also respecting the 9,000-frame model limit. Variable-frame-rate video is resampled to a constant cadence, which can duplicate/drop frames; motion interpolation is not used. The provided 25 fps source retains its original frame cadence.

`--reuse-run DIR` imports already-paid completed video locally, taking `restored.mp4` or the retained `enhanced.mp4` if the former was renamed. It verifies model, source path, FPS, dimensions and decoded frame counts, adds coverage boundaries to the scene plan, and cuts that paid output losslessly for reuse. The original input file must not have been replaced since the older run; older runs did not save its fingerprint. Original paid files remain untouched. The new queue saves an input SHA-256 and hashes for scene inputs and completed outputs.

### 2. Process a resumable queue

```bash
npm run scenes:run -- --queue QUEUE-DIRECTORY
```

By default this processes **one new clip**, then stops. Repeat the same command to continue. To intentionally process a bounded larger batch or all pending clips:

```bash
npm run scenes:run -- --queue QUEUE-DIRECTORY --clips 96,161
npm run scenes:run -- --queue QUEUE-DIRECTORY --max-jobs 5
npm run scenes:run -- --queue QUEUE-DIRECTORY --all
```

`--clips` selects specific clip IDs and processes only those pending clips; completed outputs are reused. It can be combined with `--max-jobs` for a smaller upper limit.

Each clip uses a lossless local input encode, automatic Blob upload, credit preflight, diagnostics, and audio restoration. Scene inputs do not incur another CRF-16 encode before AI processing. Processing is sequential. `queue.json` is updated atomically with per-job state, source frame range, work directory, saved worker PID, output hash and errors. Completed matching outputs are skipped. Missing/changed paid outputs cause a hard stop; the queue does not silently regenerate them. Settings must match the queue snapshot. A queue lock and saved worker PID prevent simultaneous duplicate workers; a stale same-host lock can be recovered after checking the saved worker is no longer alive.

An interrupted Gateway job is resumed through the operation saved in its `job.json`, without a new generation submission. Downloaded enhanced output is reused locally. Credit errors pause the queue and preserve its completed work. Unknown failures do not cause automatic fresh paid retries. If a provider job is confirmed terminally failed, `--retry-failed` explicitly allows a fresh request for that failed clip; running/completed jobs continue to reuse their original operation. Expired provider-hosted results cannot be guaranteed recoverable if they were never downloaded.

```bash
npm run scenes:status -- --queue QUEUE-DIRECTORY
npm run scenes:status -- --queue QUEUE-DIRECTORY --watch
```

Status reads local queue/worker diagnostics; it never submits work. For an active worker's live Gateway status, use `npm run status -- --run QUEUE-DIRECTORY/work/00001 --watch` with the appropriate clip ID.

### 3. Join with the original continuous soundtrack

```bash
npm run scenes:join -- --queue QUEUE-DIRECTORY
```

This refuses incomplete queues, verifies output hashes, joins clips in source-frame order, attaches the **continuous original soundtrack from the master**, and verifies total decoded frame count, duration, audio presence and unchanged compressed audio-packet hashes. It does not concatenate separately encoded clip soundtracks, so per-clip AAC padding does not accumulate. Original AAC-compatible soundtrack packets are copied, not re-encoded. The current master/final containers are MP4; unsupported original audio codecs cause an explicit FFmpeg error rather than silent conversion.

Assembly first strips preview audio into a video-only join cache and uses exact frame-count/FPS durations, avoiding AAC priming offsets and fractional-FPS rounding drift. Matching video streams are copied without re-encoding. Mixed 8-bit yuv420p provider encodings are normalized through a local lossless H.264 cache first; mixed higher-precision formats stop for inspection rather than silently reducing precision. Final output is `restored.mp4` inside the queue directory. An existing final output is reused only if its saved hash matches.

**Pricing:** Topaz documents billing by output frames and resolution, and Vercel displays per-second pricing. No exponential billing relationship has been established. Splitting the same total frames does not guarantee a lower bill and may add rounding/request overhead. The benefits are shorter individual jobs, scene-contained processing, visible limits and recovery without discarding completed clips. Source: [Topaz billing](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/generative/starlight-precise-2.6.md), [Gateway model pricing](https://vercel.com/ai-gateway/models/starlight-precise-2.6).

Extract a time range from a local video, automatically upload only that clip to your public Vercel Blob store, process it through Vercel AI Gateway, and save the restored/upscaled MP4 with its source audio.

Requires Node.js 22+ and `npm install`. FFmpeg and FFprobe binaries are included by the dependencies; no system installation is required. Run commands from this project directory.

Put your **AI Gateway key** and **public Vercel Blob store token** in `.env`:

```dotenv
AI_GATEWAY_API_KEY=your-key
BLOB_READ_WRITE_TOKEN=your-blob-store-token
```

The existing name `VERCEL_API_KEY` is also accepted. A general Vercel account/access token will not work. `AI_GATEWAY_API_KEY` takes priority if both are present. `.env`, videos, and outputs are ignored by Git.

Preview the selected segment locally, without an API request:

```bash
npm run restore -- --input "videos/The Ketangle - ketamine angle.mp4" --start 10 --end 13 --dry-run
```

Restore and upscale it (uploads the clip and spends API credits):

```bash
npm run restore -- --input "videos/The Ketangle - ketamine angle.mp4" --start 10 --end 13
``` 

For the other video:

```bash
npm run restore -- --input "videos/The men in down - l'ultimo bonifico.mp4" --start 60 --end 65
```

`--start` and `--end` are absolute positions in seconds, including decimals. Cuts are accurate to video frame boundaries. A new directory under `outputs/` contains:

- `segment.mp4`: high-quality local cut for comparison, with audio.
- `settings.json`: source metadata and requested enhancement settings, without credentials.
- `enhanced.mp4`: model output before audio remuxing.
- `restored.mp4`: final output with the segment's original audio track.
- `upload.json`: reference and cleanup status of the temporary public source Blob.

Edit `SETTINGS` in `src/settings.ts` for fixed resize/restoration parameters. Current configuration: **5× dimensions**, **3840-pixel maximum long edge**, and **Starlight Precise 2.6**. The `auto` option applies to Proteus when that model is selected. Proportions are approximately preserved (each output dimension rounds upwards to a multiple of four for the encoder); non-square source pixels are normalized first. The input frame rate is retained in the local cut. No artificial frame interpolation or local denoise filter is applied. Proteus decides the restoration strength in Auto mode; this is not a guaranteed degree of grain removal.

The documented Gateway controls include `auto: 'Auto' | 'Manual' | 'Relative'` and manual `compression` from -1 to 1 under `providerOptions.topaz`. The model page does not document separate numeric grain/noise controls, so this script does not invent them. The `duration` API argument does not trim a Proteus input; FFmpeg trims it before upload.

Each invocation creates a fresh output directory and never overwrites the source. The clip and settings remain available after errors. Automatic generation retries are disabled. The local wait limit is configurable with `SETTINGS.timeoutHours` (24 hours); progress prints every 30 seconds. Every live run uses background polling; see long-running jobs below. A timed-out remote job may still be processing; check Gateway logs before resubmitting. Uploads stream from disk; the SDK buffers the generated result in memory, so start with short segments.

Optional `FFMPEG_PATH` and `FFPROBE_PATH` environment variables override the bundled binaries. This script does not deinterlace archival material automatically; interlaced sources may require a separate preparation step.

Verification: `npm run typecheck` or `npx tsc --noEmit`; `npm run build` then `node dist/index.js --help`.

Both provided videos passed a three-second live test. See [verification and sample outputs](VERIFICATION.md). Comparison images show the source on the left and Proteus on the right. The returned MP4s use HEVC; use a player with HEVC support.

References: [Proteus parameters](https://vercel.com/ai-gateway/models/proteus), [Gateway video setup](https://vercel.com/docs/ai-gateway/getting-started/video). Pricing depends on configuration; the lowest displayed price is not a quote for an arbitrary clip.

Regression checks: `node --import tsx --test tests/resolution.test.ts`.

If an older run reported a resolution mismatch of a few pixels, inspect its retained `restored.mp4` before submitting again. The observed provider encoder rounds requested 1690×1270 to 1692×1272. The script now requests aligned dimensions and accepts this exact alignment for older dimensions; other mismatches remain errors.

## Long-running jobs (over 600 seconds)

Vercel Gateway's single-request mode stops polling its provider after 10 minutes. Increasing `AbortSignal.timeout` cannot change this. With AI SDK 7, provider-specific `pollTimeoutMs` does not override it either. Background generation uses top-level `poll.timeoutMs`, but the persisted start request has a 300 KiB limit, so video inputs must use hosted URLs.

In `src/settings.ts`:

```ts
timeoutHours: 24,
pollIntervalSeconds: 15,
segmentUrl: '',
```

Run the normal command; upload and URL handling are automatic:

```bash
npm run restore -- --input "videos/The men in down - l'ultimo bonifico.mp4" --start 60 --end 70
```

The script extracts `segment.mp4`, streams it to a unique random-suffixed path under `proteus-segments/` in your public Blob store, saves its reference in `upload.json`, and submits only the hosted URL to Gateway. Background jobs poll every 15 seconds with a 24-hour wait limit. No inline-video or single-request fallback is used.

After downloading, remuxing audio, and verifying the result, the script deletes only the temporary Blob it created for this run. Set `SETTINGS.keepUploadedSegment: true` to keep it. On upload/processing failures or timeouts, an already-uploaded Blob is retained so a still-running job can access it; its URL is saved in `upload.json`. A failed cleanup prints a warning without discarding the successful restoration. Local files remain available.

`--dry-run` performs local preparation only, without a Blob upload or generation. `--segment-url` (or `SETTINGS.segmentUrl`) optionally reuses an existing hosted copy of the exact trimmed segment; the script never deletes a URL supplied this way. Public source URLs can be read by anyone who has them. Tokens are never saved in manifests or printed.

An existing running process must be restarted to use new settings. A timed-out remote job may remain active; avoid duplicate paid submissions without checking its status.

References: [Gateway asynchronous generation and its limits](https://vercel.com/docs/ai-gateway/modalities/video-generation#asynchronous-generation), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Long videos and the 9,000-frame model limit

Selections exceeding `SETTINGS.maxFramesPerRequest` (default 9000) are split automatically at frame boundaries. At 25 fps, a 9,000-frame chunk is 360 seconds. The 1,134-second movie has 28,350 frames and becomes four requests: 9,000 + 9,000 + 9,000 + 1,350 frames.

The script retains the full local segment, creates lossless frame-indexed chunk inputs, uploads and enhances each chunk sequentially, verifies every result, attaches the matching source-audio interval to each playable chunk, then joins the enhanced video and attaches the full segment's audio once for the final movie. Each request has its own 24-hour timeout. Temporary source Blobs are deleted after each verified chunk. Generative consistency across independently processed chunk boundaries is not guaranteed.

Use the normal full-video command, or reuse the extraction from the rejected run:

```bash
npm run restore -- --input "videos/The men in down - l'ultimo bonifico.mp4" --start 0 --end 1134 --resume outputs/The_men_in_down_-_l_ultimo_bonifico-0-1134-mjGqVn
```

`--resume DIR` requires the same input, time range, model, enhancement options, dimensions, and chunk limit. Verified completed chunks are reused without another generation request. Existing uploaded chunk sources are reused when retained. A stable `generation-key.txt` supplies the Gateway idempotency header for each chunk; do not delete it during recovery. Gateway deduplication is not a guarantee of indefinite recovery of expired jobs: check the provider status before resuming an interrupted in-flight request.

`--dry-run` reuses/prepares the full local segment and saves the chunk plan without uploads or paid requests. `--max-chunk-frames N` can lower the chunk limit (1–9000); the setting is saved for resume checks. A manually supplied `--segment-url` works only for a single-chunk selection; leave it empty for automatic chunking/upload.

Outputs include `chunk-0001/`, `chunk-0002/`, etc., per-chunk `request.json`, Blob manifests and generation keys, and the final top-level `restored.mp4`. The rejected earlier whole-movie Blob is retained in the original `upload.json`; chunk processing does not delete that unrelated retained source.

Run all offline regression checks with `node --import tsx --test tests/*.test.ts`. The integration check uses real FFmpeg and mocked Blob/model calls, verifies every decoded frame against an independently scaled full clip, checks audio presence, and proves reassembly can resume without regenerating completed chunks. Tests use the Node.js module-hook API available in Node 22.15+ and Node 24.

## Live status and diagnostics

Check an existing run in another terminal without restarting the generation:

```bash
npm run status -- --run outputs/The_men_in_down_-_l_ultimo_bonifico-0-1134-U12gpY
```

Add `--watch` to repeat every 15 seconds. This command only reads files and checks existing Gateway jobs. It does not submit, retry or cancel generations, nor download the output. It reports each saved chunk, the final output, the Gateway status, job ID, elapsed submission time and any provider diagnostics/errors. It stops watching when no inspected job is pending; a later chunk can be checked by running it again.

Future generation invocations also save per-chunk:

- `job.json`: model and operation reference for independent status checks.
- `diagnostics.json`: latest stage, frame count, dimensions, upload bytes/percentage/time, Gateway state, job ID, number of status polls, last HTTP response code and time, output verification and cleanup state.
- `events.jsonl`: timestamped diagnostic updates for investigation.

Console heartbeat messages include the stage, Gateway status, poll count, HTTP code, age of the last response and job ID. Upload messages include percentage, MiB and transfer rate. Provider data is reported when supplied; no render percentage, frame-processing speed, queue position or ETA is invented.

These changes do not alter already-running Node processes. The active `U12gpY/chunk-0001` job reference was recovered read-only from Gateway Logs and confirmed with its status API, so the status command can inspect that chunk now. Later chunks from that older running process will not automatically save new diagnostic files. The team-wide [Gateway Logs](https://vercel.com/the-monster-team/~/ai-gateway/logs) shows active asynchronous jobs; the API-key request table can omit the active job. Use the Request Mode / Async filter to focus the list.

## Recovering paid outputs and credit exhaustion

A Gateway credit-balance error stops further processing; downloaded enhanced video remains on disk. The script now checks the Gateway balance before uploading or generating each missing chunk and records `run-status.json` as `paused-for-credits` when no positive balance remains. A positive balance is not a quote or a spending cap for the next chunk.

Every restored chunk now includes the corresponding soundtrack from the full local segment, even though the model's chunk inputs can be video-only. Audio presence and duration are checked against the full source's audio requirement. Existing silent restored chunks are repaired locally; an existing `enhanced.mp4` is reused without another generation call. Original silent output is retained as `restored.video-only.mp4` when repairing it.

For recovery with **no uploads or generation**, use:

```bash
npm run restore -- --input "videos/The men in down - l'ultimo bonifico.mp4" --start 0 --end 1134 --resume outputs/The_men_in_down_-_l_ultimo_bonifico-0-1134-U12gpY --local-only
```

This repairs/reuses available enhanced outputs and stops before the first chunk that needs generation. It does not require an API key or Blob token and never calls the credits API. A regular `--resume` run can continue missing chunks later and may spend additional credits; it is not part of local-only recovery.
