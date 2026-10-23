# Project docs

Shared notes for the team (and for our AI assistants). Read these before starting work.

| File | What it is |
|---|---|
| [requirements.md](requirements.md) | What the professor wants. The source of priorities. |
| [development.md](development.md) | Setup, repo layout, commands, testing policy. |
| [git-policy.md](git-policy.md) | Branches, commits, pull requests. Everyone follows it, AI included. |
| [schedule.md](schedule.md) | Meeting dates and the final deadline (2027-01-21). |
| [research/01-current-code-assessment.md](research/01-current-code-assessment.md) | Problems in the existing code, with evidence. |
| [research/02-tech-stack.md](research/02-tech-stack.md) | Which languages and libraries to use, and why. |
| [research/03-existing-editors.md](research/03-existing-editors.md) | How other graph editors behave (dragging, force mode). |
| [research/04-crossing-minimization.md](research/04-crossing-minimization.md) | How non-planar graphs get few crossings and still look good, with sources. |
| [research/05-landscape-review.md](research/05-landscape-review.md) | Build or adopt: existing widgets and libraries for every part of the project. |
| [research/06-interaction-review.md](research/06-interaction-review.md) | Our gestures checked against usability guidelines and user complaints; why undo exists and double-click no longer deletes. |

## Using these docs with an AI assistant

`AGENTS.md` in the repo root tells AI assistants to read these docs and follow the git policy. Codex, Copilot, Cursor and similar tools read `AGENTS.md` automatically. Claude Code reads `CLAUDE.md`, which imports `AGENTS.md`. If your tool reads neither, tell it: "Read AGENTS.md before we start."

## Rules for this folder

- Write facts and decisions, not chat logs. Date anything that can go out of date.
- When the team decides something, write it down with the reason. These notes become the report.
- Mark open questions clearly as **Open**.
