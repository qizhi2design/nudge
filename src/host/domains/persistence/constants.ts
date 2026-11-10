// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: shared limits, extension sets and element tables.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

/** `<style>` id used to persist live style overrides into static HTML pages. */
export const OVERRIDE_STYLE_ID = 'dsh-nudge-overrides'

/** Stylesheet extensions a style edit may patch textually. */
export const CSS_EXTENSIONS = new Set(['css', 'scss', 'less'])

/** Single-file component extensions that carry markup plus an optional <style>. */
export const TEMPLATE_EXTENSIONS = new Set(['vue', 'svelte', 'astro'])

/** Extensions whose bytes may contain the page markup an element lives in. */
export const MARKUP_EXTENSIONS = new Set(['html', 'htm', 'vue', 'svelte', 'astro', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'])

/**
 * Extensions a STRUCTURAL edit (remove / move / insert) may patch.
 *
 * Structural edits cut and re-insert whole element extents with the markup
 * tokenizer; JavaScript/TypeScript sources are JSX, not HTML, so cutting an
 * element there can produce syntactically invalid code (`{cond && }`,
 * `return ( )`). Until a JS-aware patch engine exists, structure edits are
 * limited to markup files and JS sources are reported as unsupported instead of
 * being corrupted. Text/attribute edits keep using MARKUP_EXTENSIONS.
 */
export const STRUCTURE_EXTENSIONS = new Set(['html', 'htm', 'vue', 'svelte', 'astro'])

/** Extensions that hold JavaScript/TypeScript (JSX) rather than HTML markup. */
export const JS_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'])

/** Extensions considered by the bounded fallback search. */
export const SEARCH_EXTENSIONS = new Set(['html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro'])

/** Directories the fallback search never descends into. */
export const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.dsh'])

/** HTML void elements never need a closing tag. */
export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Elements whose contents are raw text and must not be tokenized as markup. */
export const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

/** Hard cap for one source file read (1 MB), independent of config. */
export const READ_LIMIT = 1_000_000

/** Default candidate-file bound for the fallback search. */
export const DEFAULT_SCAN_LIMIT = 400

/** Directory-walk safety budget for the fallback search. */
export const SEARCH_DIRECTORY_BUDGET = 4000

/** Minimum relevance score a searched file must reach. */
export const SEARCH_SCORE_THRESHOLD = 3

/** Attribute names whose value is a URL (and therefore script-URL checked). */
export const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'data', 'srcset', 'background'])
