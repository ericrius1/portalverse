## What this PR adds / changes

- Room folder (if adding/editing a room): `worlds/<room-id>/`
- Summary:

## Checklist

- [ ] `pnpm run build` passes (`check:rooms` + `tsc --noEmit` + `vite build`)
- [ ] `pnpm test` passes
- [ ] Updated `CHANGELOG.md` with what changed and why
- [ ] Third-party assets credited in `worlds/<room-id>/CREDITS.md` (if any)

> **Fully automated open merge & deploy:** Once `pnpm run build` and `pnpm test` pass in CI, this PR will **automatically merge into `main` and deploy live to Railway** — no collaborator invite or manual maintainer merge needed!
> *(Open as a **Draft** or add a `hold` / `do-not-merge` label to pause auto-merge; edits to `.github/` automation files require manual maintainer review.)*
