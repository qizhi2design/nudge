// @ts-nocheck
/**
 * dsh.nudge — source persistence for live visual edits (facade).
 *
 * The implementation is split by domain under `domains/persistence/`:
 *
 *   constants.ts         shared limits, extension sets and element tables
 *   shared/text.ts       entity decoding, whitespace and text diff helpers
 *   shared/paths.ts      path, target and error helpers
 *   css/selector.ts      selector normalization and compound matching
 *   css/patch.ts         balanced-brace CSS rule scanning / patching
 *   html/tokenizer.ts    minimal HTML tokenizer and element extents
 *   html/locate.ts       element location inside one source file
 *   edits/style.ts       style edits -> CSS / HTML override / SFC <style>
 *   edits/markup.ts      text and attribute edits -> markup files
 *   planning/mapping.ts  page URL / source hints -> source file targets
 *   planning/search.ts   bounded fallback source search
 *   planning/validate.ts edit kind + shape validation
 *   index.ts             syncEdits / planEdit / processGroup (batch entry)
 *
 * This file stays a thin re-export so `src/host/index.ts` keeps importing
 * `./source-sync.js` and `lib/source-sync.js` keeps its artifact name.
 *
 * Contract (details in docs/source-sync.md)
 * ----------------------------------------
 * deps = { fs, cwd, sourceRoot, urlRoot, page, edits, policy, maxScanFiles, maxFileBytes }
 *
 * EditRecord = {
 *   id, kind: 'style'|'text'|'attr', selector, path?, property?, value?,
 *   before?, after?, textBefore?, textAfter?, attrName?, attrBefore?, attrAfter?,
 *   outerHTML?, textSnippet?, sourceHints?: { file?, line?, styleHref?, styleSelector? },
 * }
 *
 * Result = {
 *   results: [{ id, status: 'synced'|'preview'|'failed', file?, line?, strategy?, reason?, message? }],
 *   files?: string[], warnings?: string[],
 * }
 *
 * Rules
 *  - Never write outside `cwd`; every target resolved through `deps.fs` and
 *    validated with `deps.fs.contains`.
 *  - Use `deps.fs.readText` / `deps.fs.stat` and write with
 *    `deps.fs.writeText(target, text, { kind: 'replaceIfVersion', version }, signal, deps.policy)`;
 *    a `FS_STALE_VERSION` throw is retried once after a re-read.
 *  - `preview` = runtime change is live but no source file was written;
 *    `failed` = a mapped source file was found but the edit failed. Never
 *    report `synced` without a successful write.
 *  - Combine all edits that target the same file into one write.
 *  - Preserve unrelated source text exactly; never rewrite whole documents.
 *
 * This module is pure ESM, performs no I/O outside the injected `deps.fs`, and
 * has no top-level side effects.
 */

export { syncEdits } from './domains/persistence/index.js'
