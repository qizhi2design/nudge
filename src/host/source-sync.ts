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
 *   id, kind: 'style'|'text'|'attr'|'remove'|'move'|'insert', selector, path?, property?, value?,
 *   before?, after?, textBefore?, textAfter?, attrName?, attrBefore?, attrAfter?,
 *   outerHTML?, outerHTMLTruncated?, textSnippet?,
 *   sourceHints?: { file?, line?, styleHref?, styleSelector? },
 *   handle?: { openStart, line, tag, openTagDigest },
 *   targetParentSelector?, targetParentPath?, targetParentOuterHTML?, targetParentTextBefore?,
 *   beforeSelector?, beforePath?, beforeOuterHTML?, beforeTextBefore?,
 *   html?,
 * }
 *
 * remove deletes the located element's whole extent; move cuts it from the same
 * markup file and re-inserts it before `beforeSelector` (or appends it to
 * `targetParentSelector` when that is null); insert writes a captured `html`
 * snippet back (inverse of remove). A destination/anchor may also be addressed
 * by its runtime DOM path (`targetParentPath` / `beforePath`) as a last resort.
 * Both endpoints must resolve uniquely; otherwise the edit reports
 * preview/unresolved and writes nothing.
 *
 * `handle` is a server-issued identity returned in the result of a previous
 * successful edit: `{ openStart, line, tag, openTagDigest }`. When it still
 * matches the file it bypasses the heuristic locator entirely, which makes a
 * second edit on repeated markup deterministic.
 *
 * Routing is candidate-based: hints -> URL mapping -> bounded search. A hint (or
 * an existing mapped file) that resolves but does not contain the element does
 * NOT terminate the edit; the remaining candidates are probed in order.
 * Structural kinds (remove/move/insert) only patch markup files
 * (html/htm/vue/svelte/astro); JS/TSX sources are refused with
 * `unsupported-js-source` because an HTML tokenizer cannot cut JSX safely.
 *
 * Result = {
 *   results: [{
 *     id, status: 'synced'|'preview'|'failed', file?, line?, strategy?, reason?, message?,
 *     handle?: { openStart, line, tag, openTagDigest },
 *     candidates?: [{ file, why }],
 *   }],
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
