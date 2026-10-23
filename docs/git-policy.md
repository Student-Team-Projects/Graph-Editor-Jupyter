# Git policy

Agreed by the team on 2026-10-23 (develop branch added the same day). Applies to people and AI assistants alike.

## Workflow: develop + task branches

```
main      old version, untouched until the professor approves the new one
develop   integration branch: all new work lands here
<type>/…  short-lived task branches, created from develop
```

- **`main`** keeps the old, published version. Nobody commits or merges into it during the rewrite.
- **`develop`** is where the team's work comes together. Code changes don't go to it directly.
- Every task that changes code (`src/`, `js/src/`, their tests) gets a short-lived branch **from `develop`**, merged back into `develop` through a pull request.
- **Exception: small tooling, config and docs changes may be committed directly to `develop`** (for example a launcher script, an IDE run configuration, `.gitignore`, a docs fix). Commit format and "tests pass first" still apply. Decided by the team lead, 2026-10-23: a pull request for a one-file config change is more ceremony than help.
- No reviews are required. The author merges their own pull request.
- Merge task branches with **squash merge** only, so each pull request becomes **one commit** on `develop`.
- Delete the task branch after merging.
- **Release:** after the professor approves, `develop` is merged into `main` **once**, with a normal merge commit (not squash), so the task commits stay visible.
- Bigger topics (epics) are grouped with GitHub labels or milestones on Issues, not with long-lived branches.
- If possible, an organisation admin sets `develop` as the default branch on GitHub. Otherwise, choose `develop` as the target when opening a pull request.

## Branch names

`<type>/<short-description>`, lowercase, words joined with `-`. Types are the same as in commits:

```
feat/force-toggle
fix/planarity-check
docs/research
refactor/split-edit
```

## Commit messages

**One line. At most 50 characters. No body. No AI attribution lines.**

Format: `<type>: <what changed>`, in English, lowercase, imperative ("add", not "added"), no period at the end.

| Type | Use for |
|---|---|
| `feat` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code change that doesn't change behaviour |
| `test` | Adding or changing tests |
| `docs` | Documentation only |
| `chore` | Config, dependencies, tooling, cleanup |

Examples:

```
feat: force/freeze toggle
fix: planarity check ignores tuple
docs: add tech stack research
chore: add .gitattributes
```

## Pull requests

- **Title** follows the commit format, because it becomes the squash commit message on `develop`.
- **Description:** 1–3 short bullet points. Add `Closes #12` when it finishes an issue.
- Keep pull requests small: one task each.

## Day-to-day commands

```
git switch develop
git pull
git switch -c fix/planarity-check
# ...edit, test...
git add <files>
git commit -m "fix: planarity check ignores tuple"
git push -u origin fix/planarity-check
# open the pull request into develop, squash and merge, delete the branch
```

## Never commit

`.venv/`, `.idea/`, `node_modules/`, build output, scratch notebooks (`Untitled*.ipynb`), notebook outputs (clear `main.ipynb` outputs before committing), secrets.

## Line endings

We work on Windows. A `.gitattributes` file with `* text=auto eol=lf` makes git store LF line endings. Without it, git shows every file as modified. It must be added in the first pull request into `develop`, followed by `git add --renormalize .`.

## Keeping the old version

Before the rewrite starts, the current state is tagged:

```
git tag legacy-v0.0.6 e3a393f
git push origin legacy-v0.0.6
```

## Repository access

The repo is `Student-Team-Projects/Graph-Editor-Jupyter` in the course organisation. Each member gets write access by accepting the organisation invitation. No fork is needed.
