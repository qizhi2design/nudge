// @ts-nocheck
/** Client identity, remote namespace, history/sync tuning and injected capabilities. */

var NS = 'dsh.nudge';
var TAB_ID = 'dsh.nudge';
var TAB_KIND = 'nudge';
var REMOTE_NS = 'nudge';
var HISTORY_LIMIT = 200;
var COALESCE_MS = 900;
var SYNC_DEBOUNCE_MS = 550;
var SYNC_NOTICE_DISMISS_MS = 2600;

var INJECT = ['slots', 'locale', 'theme', 'sidebarRight', 'sidebarRightTabs', 'connection', 'contextMenus', 'sessions'];

var EMPTY_SELECTION = null;
