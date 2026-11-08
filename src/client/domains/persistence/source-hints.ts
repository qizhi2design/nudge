// @ts-nocheck
/** Source-provenance hints extracted from an element descriptor. */

// ------------------------------------------------------------ source sync hint

function sourceHintFromDescriptor(descriptor) {
  if (!descriptor) return null;
  var hints = descriptor.sourceHints || {};
  var file = hints.file || null;
  var line = typeof hints.line === 'number' ? hints.line : null;
  var styleHref = hints.styleHref || null;
  var styleSelector = hints.styleSelector || null;
  if (file === null && styleHref === null) return null;
  return {
    file: file,
    line: line,
    styleHref: styleHref,
    styleSelector: styleSelector,
  };
}
