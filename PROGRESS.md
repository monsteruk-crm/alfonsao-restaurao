# Scene batch workflow

- [x] Verify pricing basis and inspect existing recovery code.
- [x] Add local edit-cut detection, bounded scene files and a reviewable manifest.
- [x] Add a sequential resumable queue, saved-job recovery, status and join commands.
- [x] Preserve original soundtrack for final assembly and reuse paid coverage where valid.
- [x] Run offline end-to-end tests and prepare the supplied movie locally.

No paid generation is authorized by this ledger or started automatically by preparation.

Completed batch: `outputs/scene-batch-ultimo-with-paid-20261114/queue.json`.

- Detected 136 candidate cuts; 173 clips capped at 15 seconds.
- Reused 9000 previously paid frames as 48 completed clips; 125 pending.
- All 9000 imported decoded frames match the paid source exactly.
- Selected original soundtrack packets match the prepared master exactly.
- TypeScript, build and 17 offline tests PASS.
- Scene-batch cloud generation and full real-movie final assembly: NOT RUN.
- No uploads or paid generation requests were made in this work.

## Two authorized random enhancements — 2026-11-14

Paid run completed using topaz/starlight-precise-2.6, restricted to clips 96 and 161 via the new --clips selector. Clip 96: 7 seconds / 175 frames. Clip 161: 0.88 seconds / 22 frames (randomly selected animation rather than live action). Both outputs are 1692x1272, High-profile H.264, start at zero, retain matching-duration audio, and decode fully without FFmpeg errors. Queue now has 50 completed and 123 pending clips. Temporary uploaded Blobs were deleted after successful local verification. Evidence: outputs/scene-batch-ultimo-with-paid-20261114/random-enhancement-results.json. Observed Gateway balance decrease: approximately $0.64; this is not an itemized billing reconciliation. No additional clips were submitted.

Added --clips selection and a targeted offline integration assertion proving unselected pending clips remain pending. TypeScript, build, two scene integration tests and diff whitespace checks PASS.

Strobing investigation: software-decoded first 12 frames of every extracted clip match the source exactly (both queue folders, 173 clips each). The lossless input files use High 4:4:4 Predictive profile with yuv420p. VLC playback/loop-start compatibility remains a hypothesis, not a confirmed cause. Standard High-profile playback comparison copies for inputs 96, 161 and 120 are in inspection/*-input-vlc.mp4; lossless queue inputs are unchanged. Enhanced first-12-frame contact sheets were visually inspected: no alternating flash was evident; clip 96 is cleaner/sharper but includes reconstructed facial details. This does not prove temporal playback quality in VLC.
