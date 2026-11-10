# Source sync

`lib/source-sync.js` is the Host half of *Auto Apply* persistence. The Client
applies a visual edit to the live DOM immediately; this module maps that edit
back to the page's **source file** and performs a minimal, version-checked
textual patch so a page refresh keeps the change. It never rewrites a whole
document and never touches the DOM.

```
nudge.sync(sessionId, page, edits)
  -> lib/index.js (session/cwd/policy/sourceRoot resolution)
  -> syncEdits({ fs, cwd, sourceRoot, urlRoot, page, edits, policy, maxScanFiles, maxFileBytes })
  -> { results, files, warnings }
```

## Module layout (domain split)

`src/host/source-sync.ts` is a thin facade; the implementation lives in
`src/host/domains/persistence/`:

| module | responsibility |
| --- | --- |
| `index.ts` | batch entry (`syncEdits`), per-edit planning, grouped read/patch/write |
| `planning/mapping.ts` | page URL / source hints -> source-file targets |
| `planning/search.ts` | bounded fallback search scored by selector tokens + text |
| `planning/validate.ts` | edit kind and shape validation |
| `edits/style.ts` | style edits -> CSS rule / HTML override block / SFC `<style>` |
| `edits/markup.ts` | text and attribute edits -> markup files |
| `html/tokenizer.ts` | minimal HTML tokenizer, element extents, void/raw-text rules |
| `html/locate.ts` | element location inside one source file |
| `css/patch.ts` | balanced-brace CSS scanning and declaration updates |
| `css/selector.ts` | selector normalization, compound tokenization and matching |
| `shared/text.ts` | entity decoding, whitespace normalization, text diff |
| `shared/paths.ts` | path/target/result helpers and error mapping |
| `constants.ts` | shared limits, extension sets and element tables |

Dependency direction is a DAG (no cyclic imports). Build with
`npm run build:host`; `lib/source-sync.js` is a single-file ESM bundle produced
from the facade entry, so `lib/index.js` keeps importing `./source-sync.js`.

## Strategy order (per edit)

1. **Candidate list, not a single route.** Every edit collects ordered
   candidates (hint -> URL mapping -> search) and is written into the first one
   whose file actually contains the element. A hint or a URL-mapped file that
   resolves but cannot locate the element no longer terminates the edit.
2. **Explicit hints first** (`EditRecord.sourceHints`)
   - `styleHref` (style edits): resolved against `sourceRoot`; when that path is
     missing, a unique basename match elsewhere in the workspace is used (pages
     served from `demo/`/`public/` can hint `/app.css` while the source lives at
     `demo/app.css`). A genuinely absent stylesheet may be created with
     `createIfAbsent`; an ambiguous basename never invents a duplicate file.
   - `file`: workspace-relative or URL path, resolved against `sourceRoot`; if
     that is missing and `sourceRoot` is a workspace subdirectory, one
     workspace-relative retry keeps repo-style `data-source` hints working.
3. **Page URL mapping**
   - Only HTTP(S) pages are eligible: the origin must equal the configured
     `urlRoot` origin, or be loopback (`127.0.0.1`, `localhost`, `[::1]`) when
     `urlRoot` is empty. Non-eligible pages stay `preview` (`no-source-mapping`).
   - The URL path is decoded once, rejects NUL / `..` / absolute escapes, and
     must stay inside `sourceRoot` (`fs.resolve` + `fs.contains`). A directory
     mapping falls back to `index.html`.
4. **Bounded fallback search** under `sourceRoot` (eligible pages only, lowest priority)
   - Skips `node_modules`, `.git`, `dist`, `.dsh`, hidden directories, unknown
     extensions and files over the read limit; walks up to `maxScanFiles`
     candidates in deterministic name order.
   - Scores each candidate by selector id/class tokens (`id="x"`, class token,
     `#x` / `.x` in stylesheets) plus the edit's `textSnippet`.
   - Unique best score above a threshold wins; result reports `strategy:'search'`.
5. Nothing resolved → `preview` with `reason:'no-source-mapping'` (or
   `unsupported-source-type` when a file was found but cannot be patched
   textually, e.g. a style edit mapped to a `.js` file).

## Textual strategies

| file | edit kind | strategy label | patch |
| --- | --- | --- | --- |
| `.html`/`.htm` | style | `html-override` | update/create `<style id="dsh-nudge-overrides">` in `<head>`; rule `selector { property: value; }` merged in place |
| `.css`/`.scss`/`.less` | style | `css-rule` | balanced-brace scan for the matching rule (exact selector, else last-compound id/class token overlap); update/create the declaration; otherwise append the rule with a short comment |
| `.vue`/`.svelte`/`.astro` | style | `template-style` | first `<style>` block (or a new one appended); warning emitted because scoped styles may need `:global()` |
| markup files (incl. JSX/TSX) | text | `html-text` | locate element by id → unique normalized `outerHTML` → exact `textBefore` in a token-matched tag; replace only the changed span inside its own text node so child tags survive |
| markup files | attr | `html-attr` | replace/insert (or remove when `attrAfter: null`) one attribute in the opening tag; refuses `on*`, `style`, `srcDoc`, and script/data URLs |
| markup files | remove | `html-remove` | locate the element, cut its whole extent (`openStart..closeEnd`); a whole-line removal drops the emptied line, an inline removal keeps one separating space; refuses `html`/`head`/`body` |
| markup files | move | `html-move` | cut the source extent, re-indent and insert before `beforeSelector` (or append into `targetParentSelector` when null); a destination/anchor may also be addressed by `targetParentPath` / `beforePath`; both endpoints must resolve uniquely inside the same file; refuses protected tags, unsupported parents, and a destination inside the moved subtree |
| markup files | insert | `html-insert` | write a captured `html` snippet back (inverse of `remove`) before `beforeSelector`, or append into `targetParentSelector`; re-indents the snippet to the destination line |
| any | — | `no-op` | computed content already equals the file; reports `synced` without writing |

CSS declarations are updated with a balanced-brace/quote-aware scanner, never a
regex over the whole file. Text/attr location uses a small markup tokenizer that
knows comments, `<script>`/`<style>` raw text, void elements and nested tags, so
markup-looking strings are not mistaken for real tags. Text patches compare the
browser's whitespace-normalized `textBefore`/`textAfter`, fall back to a
whitespace-flexible match when the same words wrap across source lines, support
pure insertions verified against the resulting text, and decode/encode HTML
entities without cutting an entity span.

## Batch, write and status rules

- All edits that resolve to the same canonical file are merged into **one read,
  one patch sequence and one write**; distinct files get one write each.
- Writes use `replaceIfVersion` (existing file) or `createIfAbsent` (new hinted
  stylesheet). `FS_STALE_VERSION` triggers exactly one re-read-and-retry; any
  other error becomes `failed` with the host message.
- BOM and the dominant newline style (`\n` vs `\r\n`) are preserved.
- Files are read only up to **1 MB**; larger targets fail with
  `file-too-large`.
- Every write target is canonicalized through `fs.resolve` and validated with
  `fs.contains` against the session cwd. A defensive `read-only` policy check
  returns `preview` before any I/O; the fs service is also given `deps.policy`.
- `synced` is only ever reported after a successful write (or when no write was
  needed because the source was already correct). `preview` = live DOM only.
  `failed` = a file was found but read/write/edit failed.
- Results keep the input edit order; `file` is workspace-relative POSIX and
  `line` is reported when known.

## Reason labels

`preview`: `no-source-mapping`, `unresolved-element`, `ambiguous-element`,
`path-mismatch`, `protected-element`, `unsupported-target-parent`,
`unresolved-target-parent`, `unresolved-target-anchor`, `invalid-move-target`,
`unsupported-js-source`, `unsupported-source-type`, `unsupported-attribute`,
`unsafe-attribute`, `ambiguous-selector`, `invalid-edit`,
`unsupported-edit-kind`, `read-only-policy`, `file-missing`.

The structure-specific labels (`protected-element`,
`unsupported-target-parent`, `unresolved-target-parent`,
`unresolved-target-anchor`, `invalid-move-target`, `unsupported-js-source`) are
only reachable for `kind: 'remove' | 'move' | 'insert'`. Preview results may also
carry `candidates: [{ file, why }]` — every file that was probed, with the reason
it failed — so the UI can offer a "write to this file instead" path.

`failed`: `file-too-large`, `read-failed`, `write-failed`, `stale-version`,
`internal-error`, `fs-unavailable`, `workspace-unavailable`.

## Known limitations

- **Compiled/bundled frameworks**: React/Vue/Svelte/Astro sources are patched as
  markup text only when the element is genuinely present in the tracked file.
  Changes in compiled output (`dist/`) or generated bundles are not reflected
  back into component source, and `.js`/`.ts` files are only patched for
  text/attr edits when the markup is a literal in that file.
- **Scoped styles** in single-file components may not match runtime selectors
  without `:global()`; a warning is reported for `template-style`.
- **CSS-in-JS, CSS modules, preprocessors' variables and nested rules**, and
  rules inside `@media`/`@supports` are not targeted: a new top-level rule is
  appended instead (preprocessors that require `&` nesting may need review).
- **Dynamic content** rendered by JavaScript, virtual-DOM text nodes, and
  components whose markup comes from a server template (PHP/ERB/Handlebars) are
  preview-only or land in a template file only when the mapping is unambiguous.
- **Element `path`** from the edit record is a **last-resort locator** used only
  by `locateByPath` (native `id` / `outerHTML` / `textBefore` are tried first);
  it only matches when the source element tree mirrors the live DOM, and it is
  weakened for a truncated `outerHTML`. See `docs/dom-structure-sync.md` §4.3.
- **Style resets** (`value: ''`, the panel's reset button) stay `preview`
  (`invalid-edit`): the source of the pre-edit value is unknown, so removing a
  declaration could destroy authored CSS. Re-enter an explicit value to persist.
- **Text edits with an ambiguous changed span** (e.g. the same words appearing
  several times in the element) deliberately stay `preview`
  (`unresolved-element`) instead of guessing.
- **Structural kinds only patch markup files.** `remove` / `move` / `insert`
  accept `html`/`htm`/`vue`/`svelte`/`astro`; JS sources (`js`/`jsx`/`ts`/`tsx`/
  `mjs`/`cjs`) are refused with `unsupported-js-source` because cutting an
  element out of JSX with an HTML tokenizer produced invalid code. Text/attribute
  edits still accept those extensions.
- **Element handles.** A successful `text`/`attr`/`move`/`insert` result carries
  `handle: { openStart, line, tag, openTagDigest }`. A later edit that carries it
  back is located by that handle first, which makes repeated edits on repeated
  markup deterministic. A stale handle simply falls through to the normal
  locator.
- **Structure edits (`remove` / `move`)** are located with a narrower anchor set
  than text/attr: the runtime sends `textSnippet`, but this module's locator
  reads only `textBefore`, so the text step is skipped. A `data-source` hint is
  trusted as the file route and a locate miss inside that file does **not**
  retry URL mapping or the bounded search, so a JS-rendered node (or a page
  whose markup lives in a component while the URL maps to a shell) stays
  `preview`. `.js`/`.jsx`/`.ts`/`.tsx` are accepted for structure edits although
  the cut is not JS/JSX-aware. Full diagnosis, reproduction and the planned fix
  are in `docs/dom-structure-sync.md`.
- **Generated/hashed selectors** and shared comma-selector rules are not
  rewritten in place (a new rule with the full selector is appended), and the
  fallback search is heuristic: a sync can target the best-scoring candidate
  when several files match equally.
