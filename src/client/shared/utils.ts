// @ts-nocheck
/** Small pure helpers plus the CSS-value probe shared across Client domains. */

// ------------------------------------------------------------- utilities

var seq = 0;
function makeId(prefix) {
  seq += 1;
  return String(prefix || 'vi') + '-' + Date.now().toString(36) + '-' + seq.toString(36);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classToken(descriptor) {
  if (!descriptor) return '';
  if (descriptor.id) return '#' + descriptor.id;
  if (descriptor.classes && descriptor.classes.length > 0) return '.' + descriptor.classes[0];
  return descriptor.tag || '';
}

function shortLabel(descriptor) {
  if (!descriptor) return '';
  var base = (descriptor.tag || 'element').toLowerCase();
  if (descriptor.id) return base + '#' + descriptor.id;
  if (descriptor.classes && descriptor.classes.length > 0) {
    return base + '.' + descriptor.classes.slice(0, 2).join('.');
  }
  return base;
}

function truncate(text, max) {
  var value = String(text === undefined || text === null ? '' : text);
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function escapeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return 'null';
  }
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function hostNameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url || '';
  }
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value === '') return false;
  try {
    var parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/** Normalize an address-bar value into the same allowlist the panel accepts. */
function parseAddress(input, applicationOrigin) {
  var trimmed = String(input === undefined || input === null ? '' : input).trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (trimmed.length > 16384) return { ok: false, reason: 'invalid' };
  var candidate = /^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u.test(trimmed) ? trimmed : 'https://' + trimmed;
  var url;
  try {
    url = new URL(candidate);
  } catch (error) {
    return { ok: false, reason: 'invalid' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (applicationOrigin !== undefined && applicationOrigin !== null && applicationOrigin !== 'null') {
    try {
      if (url.origin === new URL(applicationOrigin).origin) return { ok: false, reason: 'applicationOrigin' };
    } catch (error) {
      /* ignore */
    }
  }
  return { ok: true, url: url.href, host: url.hostname };
}

/** A hidden CSS probe validates user input before the runtime sees it. */
var cssProbe = null;
function cssProbeElement() {
  if (cssProbe === null) {
    cssProbe = document.createElement('div');
    cssProbe.setAttribute('aria-hidden', 'true');
    cssProbe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;';
  }
  return cssProbe;
}

function isValidCssValue(property, value) {
  if (typeof property !== 'string' || property === '') return false;
  var text = String(value).trim();
  if (text === '' || text === 'auto' || text === 'none' || text === 'normal' || text === 'initial' || text === 'inherit' || text === 'unset' || text === 'revert') {
    return true;
  }
  var probe = cssProbeElement();
  probe.style.removeProperty(property);
  try {
    probe.style.setProperty(property, text);
  } catch (error) {
    return false;
  }
  return probe.style.getPropertyValue(property) !== '';
}
