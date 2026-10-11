# pdf.js (vendored)

Mozilla pdf.js `pdfjs-dist@4.10.38`, legacy build, Apache-2.0 (`LICENSE`). Only what text
extraction needs: `pdf.mjs`, `pdf.worker.mjs` and the packed CMaps (`cmaps/`, for Chinese
fonts without a ToUnicode table). Used by `server/pdf-text.mjs` for the knowledge search.

Fetched with `npm pack pdfjs-dist@4.10.38` (registry integrity
`sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==`),
copied unchanged. To update: same command with the new version, copy the same files, run
`node scripts/prove-knowledge.js`.
