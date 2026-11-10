## What this changes

<!-- One or two sentences. Link the Task or Bug issue. 中文也可以。 -->

## Green line

<!-- The `*_OK=1` line(s) this change prints, and where you ran them (Windows / Linux / Mac). -->

## Checklist

- [ ] A **Task** or **Bug** issue is linked
- [ ] `bash scripts/prove-scan.sh` prints `SCAN_OK=1`
- [ ] `VERSION` is bumped, a section is added at the top of `CHANGELOG.md`, and the version line is updated in `README.md`, `README.en.md` and `docs/BRIEF.zh.md`
- [ ] If patches or prove scripts changed: `node scripts/prove-patches.js` prints `PATCH_PROVE_OK=1`
- [ ] No office IPs, keys, roster files or a live `node_modules`
