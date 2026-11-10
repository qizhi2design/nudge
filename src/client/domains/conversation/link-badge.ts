// @ts-nocheck
/**
 * Conversation HTML-link affordance.
 *
 * DSH renders chat markdown links as plain anchors; opening one follows the
 * chat's link-opening preference (sidebar browser / new tab). Nudge can also
 * inspect that page, but before this bridge the only entry points were the
 * link context menu and the browser guide card. This module decorates HTML
 * links inside the conversation with a small 「轻推」badge:
 *
 *   - clicking the badge opens the page in a Nudge tab;
 *   - the badge's caret opens a tiny "打开方式" chooser that keeps the default
 *     browser action available, so the original link click is never hijacked.
 *
 * The conversation DOM is owned by React, so the badge is inserted as a sibling
 * and re-created by a MutationObserver after re-renders; nothing in the message
 * tree is mutated and the anchor's own click handler is left untouched.
 */

var NUDGE_LINK_BADGE_ATTR = 'data-dsh-nudge-link-badge';
var NUDGE_LINK_MARK_ATTR = 'data-dsh-nudge-link-mark';
var NUDGE_LINK_MENU_ATTR = 'data-dsh-nudge-link-menu';

/** Whether one workspace file path points at an HTML page. */
function isHtmlWorkspacePath(path) {
  return typeof path === 'string' && /\.html?$/i.test(path.trim());
}

/**
 * Open one workspace HTML file in a fresh Nudge tab. Chat file mentions carry
 * absolute paths; the Host preview service accepts them as long as they live
 * under the session source root.
 */
function openWorkspaceFileInNudge(ctx, sessionId, path) {
  if (!ctx || !sessionId || !isHtmlWorkspacePath(path)) return Promise.resolve(false);
  try {
    var remote = createRemote(ctx);
    return Promise.resolve(remote('previewOpen', previewOpenArgs(sessionId, path.trim())))
      .then(function (result) {
        if (!result || !result.url) return false;
        var sidebar = ctx.sidebarRight;
        if (!sidebar || typeof sidebar.openTabIn !== 'function') return false;
        sidebar.openTabIn(sessionId, TAB_KIND, { params: { url: result.url } });
        if (typeof sidebar.isExpanded === 'function' && sidebar.isExpanded() === false && typeof sidebar.toggleExpanded === 'function') {
          sidebar.toggleExpanded();
        }
        return true;
      })
      .catch(function (error) {
        console.error('[dsh-nudge] open file in nudge failed', error);
        return false;
      });
  } catch (error) {
    console.error('[dsh-nudge] open file in nudge failed', error);
    return Promise.resolve(false);
  }
}

/** Resolve one href to the HTML page URL Nudge should open, or null. */
function isHtmlConversationLinkHref(href, base) {
  if (typeof href !== 'string' || href === '') return null;
  var url = null;
  try {
    url = new URL(href, base || (typeof location !== 'undefined' ? location.href : undefined));
  } catch (error) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!/\.html?$/i.test(url.pathname)) return null;
  return url.href;
}

function nudgeLinkBadgeText(ctx, key) {
  try {
    var translate = createPluginTranslator(ctx.locale.bind(NS));
    return translate(key);
  } catch (error) {
    return key;
  }
}

function nudgeLinkBadgeStyle(interactive) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 17,
    boxSizing: 'border-box',
    padding: '0 6px',
    margin: 0,
    border: '.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 38%, transparent)',
    borderRadius: 5,
    background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 12%, transparent)',
    color: 'var(--dsw-alias-state-business-primary, #0069fb)',
    font: '10px/15px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    fontWeight: 600,
    verticalAlign: 'middle',
    cursor: interactive ? 'pointer' : 'default',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
}

function nudgeLinkMenuButtonStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: 28,
    boxSizing: 'border-box',
    padding: '0 10px',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: '12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    textAlign: 'left',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/** Close the small open-with menu if one is mounted. */
function closeNudgeLinkMenu() {
  var menu = document.querySelector('[' + NUDGE_LINK_MENU_ATTR + ']');
  if (menu !== null && menu.parentNode) menu.parentNode.removeChild(menu);
}

/**
 * Show the two-way chooser above a badge. The default entry keeps the chat's
 * browser behavior; the second entry opens the same page in Nudge.
 */
function openNudgeLinkMenu(badge, url, sessionId, ctx) {
  closeNudgeLinkMenu();
  var t = function (key) {
    return nudgeLinkBadgeText(ctx, key);
  };
  var menu = document.createElement('div');
  menu.setAttribute(NUDGE_LINK_MENU_ATTR, '');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('link.openWith'));
  var style = {
    position: 'fixed',
    zIndex: '2147483001',
    minWidth: 168,
    padding: 4,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))',
    background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff))',
    boxShadow: '0 10px 28px rgba(0,0,0,.28)',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  };
  Object.keys(style).forEach(function (key) {
    menu.style[key] = style[key];
  });
  function addItem(key, handler) {
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = t(key);
    var buttonStyle = nudgeLinkMenuButtonStyle();
    Object.keys(buttonStyle).forEach(function (name) {
      button.style[name] = buttonStyle[name];
    });
    button.addEventListener('mouseenter', function () {
      button.style.background = 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.14))';
    });
    button.addEventListener('mouseleave', function () {
      button.style.background = 'transparent';
    });
    button.addEventListener('click', function (event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      closeNudgeLinkMenu();
      handler();
    });
    menu.appendChild(button);
  }
  addItem('link.openInBrowser', function () {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  });
  addItem('link.openInspector', function () {
    openConversationLinkInNudge(sessionId, url, ctx);
  });
  document.body.appendChild(menu);
  var rect = badge.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var left = Math.max(8, Math.min(rect.left, (window.innerWidth || 0) - menuRect.width - 8));
  var top = rect.top - menuRect.height - 6;
  if (top < 8) top = rect.bottom + 6;
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
}

/** Open one page in the Nudge tab type for its conversation session. */
function openConversationLinkInNudge(sessionId, url, ctx) {
  try {
    var sidebar = ctx.sidebarRight;
    if (!sidebar) return false;
    if (sessionId === '' || typeof sidebar.openTabIn !== 'function') return false;
    sidebar.openTabIn(sessionId, TAB_KIND, { params: { url: url } });
    if (typeof sidebar.isExpanded === 'function' && sidebar.isExpanded() === false && typeof sidebar.toggleExpanded === 'function') {
      sidebar.toggleExpanded();
    }
    return true;
  } catch (error) {
    console.error('[dsh-nudge] open link in nudge failed', error);
    return false;
  }
}

/** Build the badge (label + caret) for one anchor. */
function createNudgeLinkBadge(url, sessionId, ctx) {
  var t = function (key) {
    return nudgeLinkBadgeText(ctx, key);
  };
  var badge = document.createElement('span');
  badge.setAttribute(NUDGE_LINK_BADGE_ATTR, '');
  badge.setAttribute('data-url', url);
  var inline = { display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4, verticalAlign: 'middle' };
  Object.keys(inline).forEach(function (key) {
    badge.style[key] = inline[key];
  });
  var open = document.createElement('button');
  open.type = 'button';
  open.textContent = t('link.openBadge');
  open.setAttribute('aria-label', t('link.openInspector'));
  open.title = t('link.openInspector');
  var openStyle = nudgeLinkBadgeStyle(true);
  Object.keys(openStyle).forEach(function (key) {
    open.style[key] = openStyle[key];
  });
  open.addEventListener('mouseenter', function () {
    open.style.background = 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 20%, transparent)';
  });
  open.addEventListener('mouseleave', function () {
    open.style.background = 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 12%, transparent)';
  });
  open.addEventListener('click', function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    closeNudgeLinkMenu();
    openConversationLinkInNudge(sessionId, url, ctx);
  });
  var caret = document.createElement('button');
  caret.type = 'button';
  caret.textContent = '\u25be';
  caret.setAttribute('aria-label', t('link.openWith'));
  caret.title = t('link.openWith');
  var caretStyle = nudgeLinkBadgeStyle(true);
  caretStyle.padding = '0 3px';
  caretStyle.fontWeight = 500;
  Object.keys(caretStyle).forEach(function (key) {
    caret.style[key] = caretStyle[key];
  });
  caret.addEventListener('click', function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var existing = document.querySelector('[' + NUDGE_LINK_MENU_ATTR + ']');
    if (existing !== null) {
      closeNudgeLinkMenu();
      return;
    }
    openNudgeLinkMenu(badge, url, sessionId, ctx);
  });
  badge.appendChild(open);
  badge.appendChild(caret);
  return badge;
}

/**
 * Keep the conversation's HTML links decorated. The observer coalesces bursts
 * into one animation frame and only reacts to node/href changes.
 */
function installConversationLinkBadges(ctx) {
  if (
    typeof document === 'undefined' ||
    document.body === null ||
    typeof document.querySelectorAll !== 'function' ||
    typeof document.createElement !== 'function'
  ) {
    return function () {};
  }
  var scheduled = false;
  var frame = 0;
  var disposed = false;

  function sessionIdOf(node) {
    var holder = node && typeof node.closest === 'function' ? node.closest('[data-conversation-session]') : null;
    var id = holder && holder.getAttribute ? holder.getAttribute('data-conversation-session') : '';
    return id === null || id === undefined ? '' : String(id);
  }

  function scan() {
    scheduled = false;
    frame = 0;
    if (disposed || typeof document.querySelectorAll !== 'function') return;
    // Drop badges whose anchor was replaced or removed by a React render.
    var badges = document.querySelectorAll('[' + NUDGE_LINK_BADGE_ATTR + ']');
    for (var b = 0; b < badges.length; b += 1) {
      var badge = badges[b];
      var previous = badge.previousElementSibling;
      if (
        !previous ||
        !previous.matches ||
        !previous.matches('a[' + NUDGE_LINK_MARK_ATTR + ']') ||
        previous.getAttribute(NUDGE_LINK_MARK_ATTR) !== badge.getAttribute('data-url')
      ) {
        if (badge.parentNode) badge.parentNode.removeChild(badge);
      }
    }
    var anchors = document.querySelectorAll('[data-conversation-region="chat"] a[href]');
    for (var index = 0; index < anchors.length; index += 1) {
      var anchor = anchors[index];
      if (anchor.closest && anchor.closest('[data-dsh-nudge-root]') !== null) continue;
      if (anchor.getAttribute(NUDGE_LINK_MARK_ATTR) === null) {
        var url = isHtmlConversationLinkHref(anchor.getAttribute('href'), location.href);
        if (url === null) continue;
        var sessionId = sessionIdOf(anchor);
        if (sessionId === '') continue;
        var next = anchor.nextElementSibling;
        if (next !== null && next.matches('[' + NUDGE_LINK_BADGE_ATTR + ']') && next.getAttribute('data-url') === url) {
          anchor.setAttribute(NUDGE_LINK_MARK_ATTR, url);
          continue;
        }
        anchor.setAttribute(NUDGE_LINK_MARK_ATTR, url);
        var created = createNudgeLinkBadge(url, sessionId, ctx);
        if (anchor.parentNode) anchor.parentNode.insertBefore(created, anchor.nextSibling);
      } else {
        var markedUrl = anchor.getAttribute(NUDGE_LINK_MARK_ATTR);
        var resolved = isHtmlConversationLinkHref(anchor.getAttribute('href'), location.href);
        if (resolved === null || resolved !== markedUrl) {
          anchor.setAttribute(NUDGE_LINK_MARK_ATTR, resolved || '');
          var stale = anchor.nextElementSibling;
          if (stale !== null && stale.matches && stale.matches('[' + NUDGE_LINK_BADGE_ATTR + ']')) stale.remove();
          if (resolved !== null) {
            var fresh = createNudgeLinkBadge(resolved, sessionIdOf(anchor), ctx);
            if (anchor.parentNode) anchor.parentNode.insertBefore(fresh, anchor.nextSibling);
          } else {
            anchor.removeAttribute(NUDGE_LINK_MARK_ATTR);
          }
        }
      }
    }
  }

  function schedule() {
    if (disposed || scheduled) return;
    scheduled = true;
    if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(scan);
    else frame = window.setTimeout(scan, 32);
  }

  function onDocumentMouseDown(event) {
    if (event && event.target && event.target.closest && event.target.closest('[' + NUDGE_LINK_MENU_ATTR + ']') !== null) return;
    if (event && event.target && event.target.closest && event.target.closest('[' + NUDGE_LINK_BADGE_ATTR + ']') !== null) return;
    closeNudgeLinkMenu();
  }

  function onDocumentKeyDown(event) {
    if (event && event.key === 'Escape') closeNudgeLinkMenu();
  }

  /** Rebuild every badge so a plugin-language change updates the label. */
  function relabel() {
    if (disposed || typeof document.querySelectorAll !== 'function') return;
    closeNudgeLinkMenu();
    var existing = document.querySelectorAll('[' + NUDGE_LINK_BADGE_ATTR + ']');
    for (var index = 0; index < existing.length; index += 1) {
      if (existing[index].parentNode) existing[index].parentNode.removeChild(existing[index]);
    }
    var marked = document.querySelectorAll('[' + NUDGE_LINK_MARK_ATTR + ']');
    for (var m = 0; m < marked.length; m += 1) marked[m].removeAttribute(NUDGE_LINK_MARK_ATTR);
    schedule();
  }

  var unsubscribeConfig = typeof subscribePluginConfig === 'function' ? subscribePluginConfig(relabel) : null;
  var observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  if (observer !== null) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  schedule();

  return function () {
    disposed = true;
    if (unsubscribeConfig !== null) unsubscribeConfig();
    if (observer !== null) observer.disconnect();
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    if (frame !== 0) {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
      else if (typeof window.clearTimeout === 'function') window.clearTimeout(frame);
      frame = 0;
    }
    closeNudgeLinkMenu();
    var leftovers = document.querySelectorAll('[' + NUDGE_LINK_BADGE_ATTR + ']');
    for (var index = 0; index < leftovers.length; index += 1) {
      if (leftovers[index].parentNode) leftovers[index].parentNode.removeChild(leftovers[index]);
    }
    var marked = document.querySelectorAll('[' + NUDGE_LINK_MARK_ATTR + ']');
    for (var m = 0; m < marked.length; m += 1) marked[m].removeAttribute(NUDGE_LINK_MARK_ATTR);
  };
}
