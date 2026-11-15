# Verification — 2026-11-13

Used the real `.env` key, without displaying or storing it in results. Two successful paid Proteus requests processed three seconds each. Exact cost and Gateway dashboard logs were not checked.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run build`, compiled CLI help | PASS |
| Invalid end-before-start input | PASS: rejected before extraction/upload |
| Local dry-run extraction, both sources | PASS: no API requests |
| `.env`, `videos/`, `outputs/` ignored by Git | PASS |
| Live Ketangle, 10–13s | PASS: 320×240 → 640×480, 75 frames, 25000/1001 fps, 3.003s, AAC audio |
| Live Ultimo bonifico, 60–63s | PASS: 338×254 → 676×508, 75 frames, 25 fps, 3.000s, AAC audio |
| Full FFmpeg audio/video decode of both restored clips | PASS |
| Output dimensions and frame counts independently compared with saved requests | PASS |

Results:

- [Ketangle restored](outputs/The_Ketangle_-_ketamine_angle-10-13-MjDogF/restored.mp4)
- [Ketangle comparison](outputs/The_Ketangle_-_ketamine_angle-10-13-MjDogF/comparison.png)
- [Ultimo bonifico restored](outputs/The_men_in_down_-_l_ultimo_bonifico-60-63-fmuXTZ/restored.mp4)
- [Ultimo bonifico comparison](outputs/The_men_in_down_-_l_ultimo_bonifico-60-63-fmuXTZ/comparison.png)
- [Machine-readable checks](outputs/live-verification.json)

Comparison PNGs show a frame 1.5 seconds into each clip: local source enlarged with Lanczos on the left, Proteus output on the right. Visual inspection shows cleaner, smoother surfaces in the second sample; this is a subjective single-frame check, not a complete assessment of motion or restoration fidelity. Audio presence and decoding were verified; listening was not performed. Model output was HEVC in MP4.

An initial asynchronous request was rejected because inline video exceeded the Gateway's 300 KB job-persistence limit. The implementation now uses synchronous generation with local file bytes, which succeeded for both clips. The rejected attempt's extracted clip remains in `outputs/The_Ketangle_-_ketamine_angle-10-13-SXH6dU/`.

The first live process survived a tool-server restart; its completion was established from the saved output and independent FFprobe/FFmpeg checks. Both runs used the final request shape. Subsequent local verification checks for missing audio and mismatched frame counts were added without submitting additional paid jobs.

## 5× resolution alignment correction

The later 60–70s run requested 1690×1270 and returned 1692×1272. The original exact-dimension check incorrectly rejected a complete result. Independent inspection confirmed 250 frames, 25 fps, 10 seconds, and audio. The complete output decoded successfully with FFmpeg. It remains at `outputs/The_men_in_down_-_l_ultimo_bonifico-60-70-htNPAg/restored.mp4`; machine-readable recovery checks are alongside it in `verification.json`.

The resize calculation now aligns output dimensions upwards to four pixels and retains the user's 5× setting. Validation accepts exact dimensions or that precise upward alignment, while rejecting other mismatches. TypeScript, build, four focused regression tests, and a one-second local dry-run passed. No new paid generation was submitted for this correction.

## Automatic Blob upload and background generation

Verified on 2026-11-13 using the configured public Blob store and real Gateway key:

- Normal CLI, without `--segment-url`: Ultimo bonifico, 60–61s, Starlight Precise 2.6, 5× output.
- Automatic streamed multipart upload: PASS. Unauthenticated download of the public Blob matched the local 51,556-byte segment exactly by SHA-256.
- Gateway background start/status flow: PASS. Only the hosted URL was submitted, with a configured 24-hour polling timeout and 15-second interval.
- Download, audio remux, dimensions, frame count and full audio/video decode: PASS. Output 1692×1272, 25 frames, 25 fps, 1.000s, audio present.
- Temporary source Blob deletion after successful verification: PASS, confirmed by successful Blob SDK `del`; status recorded as `deleted-after-success`.
- [Restored sample](outputs/The_men_in_down_-_l_ultimo_bonifico-60-61-pZvhFE/restored.mp4), [upload byte verification](outputs/The_men_in_down_-_l_ultimo_bonifico-60-61-pZvhFE/upload-verification.json), [output verification](outputs/The_men_in_down_-_l_ultimo_bonifico-60-61-pZvhFE/verification.json).
- TypeScript, build, four resolution regression tests, and dry-run with both credentials explicitly blank: PASS. Dry-run made no uploads or generation requests.
- Dependency audit after aligning Blob's transitive Zod dependency with the patched version used by AI SDK: zero reported vulnerabilities.

The short live run finished after approximately one minute; waiting beyond 600 seconds or for 24 hours was not exercised. Uploaded sources are retained on failed/timed-out generations, and user-supplied source URLs are never deleted. Those failure/retention branches were inspected but not induced against the live provider.

## Full-movie frame-limit correction

The reported live rejection established a 9,000-frame limit for `slp-2.6`. The 0–1134s selection contains 28,350 frames. Automatic frame-based chunking now plans four sequential requests (9000, 9000, 9000, 1350), checks actual extracted counts before upload, and assembles all enhanced frames with the full segment's audio.

- Real failed-run extraction reused with `--resume ... --dry-run`: PASS; plan saved in the existing run directory, no upload or generation.
- Offline integration with real FFmpeg, fake Blob/model responses, and a 105-frame synthetic video: PASS. Three requests of 40, 40, 25 frames; assembled output has all 105 frames and audio. Every decoded output frame matches an independently scaled full-segment reference.
- Resume after removing only the assembled output: PASS; all completed chunks reused, no additional model calls, identical decoded-frame hashes after reassembly.
- Chunk boundary and invalid-limit unit checks, prior resize regressions, TypeScript and build: PASS.
- Full-movie paid chunk generation and visual quality across chunk boundaries: NOT RUN. The earlier public whole-movie Blob remains retained; no cleanup of that failed-run source was attempted.

An initial offline test caught a final-frame discard in FFmpeg's passthrough chunk output. Explicit output frame rate/CFR corrected it; decoded frame count and per-frame hash comparison now verify the boundary behavior for the provided 25 fps workflow.

## Live-job visibility and diagnostics

Read-only inspection of the active `U12gpY` run found its local process alive, chunk 1 uploaded at 18:44, and no completed chunks. Gateway Logs independently showed `job_1CXJMSZDXW046FBP2TRCD82Q8R` submitted 18:44:02, Running, with its brief queue phase completed and Topaz phase ongoing. The API-key table's latest 18:36:20 / 400 entry belongs to the earlier rejected whole-movie request.

The operation `{jobId: ...}` recovered from the dashboard was confirmed with `getVideoStatus`, returning pending / Gateway running / attempts 1, and saved to the active chunk's `job.json`. A new `npm run status` invocation checked the same job successfully at 19:34:42 UTC: 3041 seconds since submission, no outputs saved out of four. No percentage or ETA was returned. The active generation was not restarted, cancelled or resubmitted.

New invocations capture job operations and status metadata, HTTP codes/timestamps, polling counts, upload metrics, verification/cleanup stages and JSONL history. A focused diagnostics test covers operation persistence, real pending/running observations, error HTTP status and credential/media redaction. TypeScript, build and all nine offline tests passed. The status command was live-tested against the existing job. The new generation-side transport hook/upload-progress reporting was tested locally, without submitting a new paid generation; existing running processes do not pick up these source changes.

## Paid chunk 1 recovery and missing-audio correction

The U12gpY run completed its first 9000-frame / 360-second enhancement, saved both `enhanced.mp4` and `restored.mp4`, and stopped when Gateway rejected chunk 2 for lacking a positive credit balance. Chunk 2 had been uploaded but no enhanced output was saved. The reported $30 spend was supplied by the user; the exact bill was not independently reconciled in this repair.

The chunking implementation intentionally created video-only inputs and attached full audio only at final assembly. This made individual `restored.mp4` chunks silent, and validation checked those chunks against their silent inputs rather than the full source. This was an implementation and test coverage defect for independently playable chunk outputs.

Recovered chunk 1 locally, without any generation or upload:

- Output: `outputs/The_men_in_down_-_l_ultimo_bonifico-0-1134-U12gpY/chunk-0001/restored.mp4`.
- Restored the first 360 seconds of the retained full segment's soundtrack.
- Verified 9000 decoded video frames, 1692×1272, 360-second video and 360-second audio.
- Compressed-video packet SHA-256 matches `enhanced.mp4` exactly: `33425888d5d7e8cd92087962c5fe63281bb3eaadc6754445ab07257242e4eac8`; no video re-encoding or AI regeneration.
- Decoded audio samples at 0, 120 and 350 seconds have correlations 0.99989, 0.99882 and 0.99995 against the corresponding source audio, with nonzero RMS. Listening was not performed.
- Original silent restored output retained as `restored.video-only.mp4`. Evidence saved in `audio-recovery.json`.
- Run state recorded as paused-for-credits, one completed chunk out of four. No continuation or top-up performed.

Implementation now attaches the correct source-audio interval to every chunk; validates audio presence and duration; repairs old silent restored chunks; reuses already-downloaded enhanced video before any network preflight; offers `--local-only`; and checks balance before uploads for missing chunks. Offline integration tests now validate each chunk's soundtrack timing against a varying synthetic reference, recover an old silent chunk without further model calls, recover from `enhanced.mp4` with zero credits, stop before upload on zero balance, and stop local-only recovery before a missing chunk. Full-movie final assembly after paid chunk 1 remains NOT RUN; no new paid tests were necessary.

The confirmed credit-rejected chunk-2 generation key was archived locally so a later explicitly resumed request does not replay a cached credit failure. The script now archives keys only on explicit provider credit-rejection errors, not on unknown timeouts. An offline credit-rejection-after-preflight test confirms this pause/archival behavior without another generation.

## Scene-based batch workflow — 2026-11-14

Implemented four commands: `scenes:split`, `scenes:run`, `scenes:status`, `scenes:join`. Configuration moved unchanged to shared `src/settings.ts`. The existing restore/status commands remain available.

Prepared the actual movie locally in `outputs/scene-batch-ultimo-with-paid-20261114/`:

- Input selection 0–1134s, 25 fps, 28350 frames.
- FFmpeg scene-score threshold 0.3 detected 136 candidate edit cuts. These are algorithmic detections, not a manual audit of every edit.
- Fifteen-second clip cap plus paid-coverage boundary yielded 173 clips, with contiguous non-overlapping frame ranges. Source videos and per-clip audio were prepared locally.
- The repaired original chunk had been renamed by the user. Reuse read the retained `enhanced.mp4`, leaving the renamed audio-equipped file and all old paid files untouched.
- All first 9000 paid frames / 360 seconds imported as 48 completed clips; 125 pending. A full decoded-frame MD5 comparison of the 48 imported clips against the original paid enhancement matched all 9000 frames exactly. Evidence: `paid-prefix-verification.json`.
- Original selected AAC packet SHA-256 equals master AAC packet SHA-256: `aee7f35df84176837d51b7d4658979ce8a3f5c01c3ade1d291149a134e6237c4`. Evidence: `audio-master-verification.json`.
- Master SHA-256 saved to queue metadata so changes to the continuous soundtrack/master cannot silently alter assembly.
- A preliminary queue without paid imports was marked superseded; it cannot be accidentally processed. Its replacement is identified in its manifest.

Queue mechanics: atomic manifests, stable worker directories, locking/live PID checks, input and output hashes, completed-artifact reuse, pause on errors, default one new clip per run, explicit bounded/all batches, and explicit retries only for confirmed terminal failures. Existing Gateway operations are polled/downloaded on resume without another start call. Audio is present in individual restored clips; final assembly uses the continuous original master soundtrack and verifies its compressed packet hashes.

Validation: TypeScript, build and 17 offline tests PASS. End-to-end synthetic edits detected expected cuts; bounded scene segmentation and source-frame reassembly preserved every decoded frame; final soundtrack packets matched the original synthetic input. Paid-prefix reuse, zero-credit pause/resume, missing-artifact hard stop, and saved-job recovery with zero credits/no upload/no new generation were tested with mocked provider/Blob responses and real FFmpeg. Incomplete or changed outputs are not silently regenerated. Runtime API/Blob generation of the new scene queue and final assembly of this real movie remain NOT RUN. No new paid requests or uploads were made.

Pricing review: official Topaz documentation bills per output frame and resolution, with rounding. An exponential billing relationship was not established. Scene splitting can improve bounded retries and operational recovery; it does not guarantee a cheaper total render.

Fractional-FPS regression coverage was added for the second video's 25000/1001 cadence. This exposed an avoidable CRF-16 encode in the worker and an AAC-priming offset in concat inputs. Scene workers now use `--lossless-input`; join uses video-only inputs with exact frame-count/FPS durations. The regression verifies every decoded frame, exact fractional FPS, zero video start offset and a 2.002-second video timeline after assembly. These corrections do not modify any existing paid files.

## Two authorized random enhancements — 2026-11-14

Paid run completed using topaz/starlight-precise-2.6, restricted to clips 96 and 161 via the new --clips selector. Clip 96: 7 seconds / 175 frames. Clip 161: 0.88 seconds / 22 frames (randomly selected animation rather than live action). Both outputs are 1692x1272, High-profile H.264, start at zero, retain matching-duration audio, and decode fully without FFmpeg errors. Queue now has 50 completed and 123 pending clips. Temporary uploaded Blobs were deleted after successful local verification. Evidence: outputs/scene-batch-ultimo-with-paid-20261114/random-enhancement-results.json. Observed Gateway balance decrease: approximately $0.64; this is not an itemized billing reconciliation. No additional clips were submitted.

Added --clips selection and a targeted offline integration assertion proving unselected pending clips remain pending. TypeScript, build, two scene integration tests and diff whitespace checks PASS.

Strobing investigation: software-decoded first 12 frames of every extracted clip match the source exactly (both queue folders, 173 clips each). The lossless input files use High 4:4:4 Predictive profile with yuv420p. VLC playback/loop-start compatibility remains a hypothesis, not a confirmed cause. Standard High-profile playback comparison copies for inputs 96, 161 and 120 are in inspection/*-input-vlc.mp4; lossless queue inputs are unchanged. Enhanced first-12-frame contact sheets were visually inspected: no alternating flash was evident; clip 96 is cleaner/sharper but includes reconstructed facial details. This does not prove temporal playback quality in VLC.
