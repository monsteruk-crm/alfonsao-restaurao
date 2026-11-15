# Repository Guidelines

## Project Structure & Module Organization

Proteus is a Node.js/TypeScript CLI for video restoration through Topaz models on Vercel AI Gateway. `src/index.ts` handles segment restoration; `src/scenes.ts` manages scene queues. Supporting modules cover media operations, chunk planning, diagnostics, status, and recovery. Shared enhancement defaults live in `src/settings.ts`.

Tests are in `tests/*.test.ts`, with provider mocks in `tests/fixtures/`. Local source videos belong in `videos/`; generated media and job manifests belong in `outputs/`. Both directories and compiled `dist/` are ignored. Consult `README.md` for workflows, `MODELS.md` for model notes, and `PROGRESS.md`/`VERIFICATION.md` for recorded evidence.

## Build, Test, and Development Commands

Use Node.js 22.15+ or Node.js 24 for the test hooks. FFmpeg and FFprobe binaries come from npm dependencies.

- `npm ci`: install dependencies from the lockfile.
- `npx tsc --noEmit`: check strict TypeScript types without emitting files.
- `npm run build`: compile `src/` into `dist/`.
- `npm run restore -- --help`: inspect restoration options.
- `npm run restore -- --input videos/sample.mp4 --start 0 --end 3 --dry-run`: prepare a local segment without uploads or generation.
- `npm run scenes:status -- --queue outputs/QUEUE`: inspect a local queue without submitting work.

## Coding Style & Naming Conventions

Follow existing TypeScript conventions: two-space indentation, semicolons, single-quoted strings, camelCase functions/variables, and PascalCase types/classes. Use descriptive lowercase, hyphenated module filenames such as `scene-plan.ts`. Keep `.js` extensions on relative imports for NodeNext ESM compatibility. No formatter or lint script is configured; match surrounding code and retain strict typing.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Run a focused file with `node --import tsx --test tests/resolution.test.ts`; run all offline checks with `node --import tsx --test tests/*.test.ts`. Integration tests use real FFmpeg with mocked cloud calls. No coverage threshold is configured. Cover relevant frame boundaries, audio preservation, and recovery behavior; assess visual quality separately from technical validity.

## Commit & Pull Request Guidelines

There are no commits yet, so no established message convention exists. Prefer concise, imperative subjects such as `Fix scene queue recovery`. PRs should describe behavior changes, relevant issues, validation commands/results, and media evidence when applicable.

## Configuration & Paid Operations

Copy `.env.example` to `.env` for cloud credentials; never commit secrets. Obtain explicit authorization before uploads or paid generation. Preserve saved job references, generation keys, hashes, and completed outputs during recovery to prevent duplicate submissions. Record validation results in `VERIFICATION.md` and workflow progress in `PROGRESS.md`.

<!-- hippo:start -->
## Project Memory (Hippo)

When Hippo's prompt hook is installed, it injects pinned rules and the
memories that match each prompt, so never load them yourself. If no hippo
memory block has appeared in this session, run this at the start of a task
and read the output before writing any code:
```bash
hippo context --auto --budget 1500
```

On errors or unexpected behaviour, record it right then, while you work,
never as a closing step:
```bash
hippo remember "<description of what went wrong>" --error
```

When you learn something that should outlive this session (a decision and
its reason, a user preference, a lesson), record it right then, while you
work, never as a closing step. Leave out secrets and personal details:
```bash
hippo remember "<what you learned and why>"
```

When Hippo's Codex wrapper is installed, session-end capture runs automatically.
If the wrapper is not installed, capture a brief summary manually:
```bash
hippo capture --stdin <<< '<decisions, errors, lessons: 2-5 bullets>'
```
<!-- hippo:end -->
