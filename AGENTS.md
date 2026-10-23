# Instructions for AI assistants

This repo is a university team project (UJ TCS, "Projekt programistyczny"): a graph editor widget for Jupyter.

## Before doing anything

Read these files first, every session:

1. `docs/README.md`: index of the docs
2. `docs/requirements.md`: what we are building. Priorities come from here.
3. `docs/git-policy.md`: how to use git. Follow it exactly.
4. `docs/development.md`: setup, repo layout, commands
5. `docs/schedule.md`: deadlines
6. `docs/research/`: background on the old code and the chosen tech stack

## Git rules (summary of docs/git-policy.md)

- Never commit to `main`. Code changes (`src/`, `js/src/`, their tests) go on a branch from `develop` named `<type>/<short-description>`; pull requests target `develop`, never `main`.
- Small tooling, config and docs changes may be committed directly to `develop` (see docs/git-policy.md).
- `main` holds the old version and stays untouched until the professor approves the new one.
- Commit messages: **one line, at most 50 characters, no body, no AI attribution or Co-Authored-By lines.** Format: `<type>: <what changed>`, with type one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Never push, merge, tag, or change anything on GitHub unless the user explicitly asks in this session.
- Never commit `.venv/`, `.idea/`, `node_modules/`, build output, `Untitled*.ipynb` or notebook outputs (if `main.ipynb` changed only by running it, restore it instead of committing).

## Working style

- Keep changes small and focused on one task.
- Every new feature or bug fix needs tests in `tests/` (Python) or `js/src/*.test.ts` (TypeScript), in the same pull request (see the testing policy in `docs/development.md`).
- Every mistake found, including during review, gets a regression test that would have caught it.
- Run `pytest` and, for TypeScript changes, `npm run typecheck` and `npm test` in `js/` before every commit. Never commit with failing tests.
- If a decision is not covered by the docs, ask the user instead of guessing.
- When the team decides something new, update the matching file in `docs/`.
