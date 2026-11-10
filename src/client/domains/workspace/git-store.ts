// @ts-nocheck
/**
 * Pure helpers shared by the workspace panel and the inspector body's
 * hot-reload loop. Nothing here touches React, the bridge or timers, so the
 * panel test can exercise every rule directly.
 *
 * Contract: docs/workspace-versions.md sections 3 and 5.
 */

var HOT_RELOAD_POLL_MS = 900;
var HOT_RELOAD_DEBOUNCE_MS = 120;
var COMMIT_MESSAGE_MAX = 4000;
var WATCH_CHANGED_LIMIT = 8;

/** True for a usable monotonic watcher revision (0 is a valid first baseline). */
function workspaceRevisionPresent(value) {
  if (value === null || value === undefined || value === '') return false;
  var numeric = Number(value);
  return Number.isFinite(numeric);
}

/**
 * Decide what the poller does when `nextRevision` arrives.
 *
 * - first response (`previousRevision` absent), closed watch (`nextRevision`
 *   absent) or an unchanged revision -> 'ignore'
 * - changed while the page is in browse mode -> 'reload'
 * - changed during annotate/edit -> 'defer' (the body sets `reloadPending`
 *   and reloads once the user returns to browse)
 */
function hotReloadDecision(previousRevision, nextRevision, mode) {
  if (!workspaceRevisionPresent(previousRevision)) return 'ignore';
  if (!workspaceRevisionPresent(nextRevision)) return 'ignore';
  if (Number(previousRevision) === Number(nextRevision)) return 'ignore';
  return mode === 'browse' ? 'reload' : 'defer';
}

// ------------------------------------------------------------ labels

var WORKSPACE_CHANGE_LABEL_KEYS = {
  modified: 'commit.changeModified',
  added: 'commit.changeAdded',
  deleted: 'commit.changeDeleted',
  renamed: 'commit.changeRenamed',
  untracked: 'commit.changeUntracked',
  conflicted: 'commit.changeConflicted',
};

/** Locale key for one `git.available.changes[].label` value. */
function changeLabelKey(label) {
  var key = WORKSPACE_CHANGE_LABEL_KEYS[String(label || '')];
  return key === undefined ? 'commit.changeUnknown' : key;
}

/** Short localized label for one changed file. */
function changeLabelText(t, label) {
  return t(changeLabelKey(label));
}

// ------------------------------------------------------------ path / time

function workspacePathName(path) {
  var text = String(path === null || path === undefined ? '' : path);
  var index = text.lastIndexOf('/');
  return index === -1 ? text : text.slice(index + 1);
}

function workspacePathDir(path) {
  var text = String(path === null || path === undefined ? '' : path);
  var index = text.lastIndexOf('/');
  return index === -1 ? '' : text.slice(0, index);
}

/** Shorten a long path from the left so the file name stays readable. */
function shortenWorkspacePath(path, maxLength) {
  var text = String(path === null || path === undefined ? '' : path);
  var limit = typeof maxLength === 'number' && maxLength > 4 ? maxLength : 40;
  if (text.length <= limit) return text;
  return '…' + text.slice(text.length - (limit - 1));
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

/** `YYYY-MM-DD HH:mm` in the local zone; invalid input falls back to its text. */
function formatCommitTime(value) {
  var date = value instanceof Date ? value : new Date(String(value === null || value === undefined ? '' : value));
  if (Number.isNaN(date.getTime())) return String(value === null || value === undefined ? '' : value);
  return (
    date.getFullYear() +
    '-' +
    pad2(date.getMonth() + 1) +
    '-' +
    pad2(date.getDate()) +
    ' ' +
    pad2(date.getHours()) +
    ':' +
    pad2(date.getMinutes())
  );
}

function formatBytes(value) {
  var bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ------------------------------------------------------------ snapshots

function workspaceFiles(workspace) {
  return workspace && Array.isArray(workspace.htmlFiles) ? workspace.htmlFiles : [];
}

/**
 * The page a freshly opened workspace should start on: an `index.html` entry
 * point wins (root-most first), then the shallowest file, then path order.
 * Returns null for an empty scan so the caller can leave the address bar alone.
 */
function firstWorkspaceHtmlFile(workspace) {
  var files = workspaceFiles(workspace);
  var best = null;
  var bestRank = null;
  files.forEach(function (file) {
    var path = String((file && file.path) || '');
    if (path === '') return;
    var name = String((file && file.name) || workspacePathName(path)).toLowerCase();
    var depth = path.split('/').length - 1;
    var entryPoint = name === 'index.html' || name === 'index.htm' ? 0 : 1;
    var rank = [entryPoint, depth, path];
    if (best === null || compareWorkspaceFileRank(rank, bestRank) < 0) {
      best = file;
      bestRank = rank;
    }
  });
  return best;
}

/** Lexicographic rank compare for `firstWorkspaceHtmlFile`. */
function compareWorkspaceFileRank(left, right) {
  for (var index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function workspaceChanges(workspace) {
  return workspace && workspace.git && Array.isArray(workspace.git.changes) ? workspace.git.changes : [];
}

function workspaceBranches(workspace) {
  return workspace && workspace.git && Array.isArray(workspace.git.branches) ? workspace.git.branches : [];
}

function workspaceGit(workspace) {
  return workspace && workspace.git && typeof workspace.git === 'object' ? workspace.git : null;
}

function workspaceGitAvailable(workspace) {
  var git = workspaceGit(workspace);
  return git !== null && git.available === true;
}

function workspaceIsDirty(workspace) {
  return workspaceGitAvailable(workspace) && workspace.git.clean === false;
}

/** Write actions require both a writable session and an available repository. */
function workspaceWritable(workspace) {
  return workspace !== null && workspace !== undefined && workspace.writable !== false && workspaceGitAvailable(workspace);
}

/** Filter HTML files by a case-insensitive path / name substring. */
function filterWorkspaceFiles(files, query) {
  var list = Array.isArray(files) ? files : [];
  var needle = String(query === null || query === undefined ? '' : query).trim().toLowerCase();
  if (needle === '') return list.slice();
  return list.filter(function (file) {
    var path = String((file && file.path) || '').toLowerCase();
    var name = String((file && file.name) || '').toLowerCase();
    return path.indexOf(needle) !== -1 || name.indexOf(needle) !== -1;
  });
}

/** Match the embedded page URL back to one scanned HTML file. */
function inferActiveFile(workspace, url) {
  var files = workspaceFiles(workspace);
  if (files.length === 0) return null;
  var pathname = '';
  try {
    pathname = new URL(String(url === null || url === undefined ? '' : url)).pathname.replace(/^\/+/, '');
  } catch (error) {
    return null;
  }
  if (pathname === '') return null;
  var decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    decoded = pathname;
  }
  var best = null;
  files.forEach(function (file) {
    var path = String((file && file.path) || '');
    if (path === '') return;
    var matches = decoded === path || decoded.slice(-(path.length + 1)) === '/' + path;
    if (!matches) return;
    if (best === null || path.length > String(best.path).length) best = file;
  });
  return best;
}

/** Changed-file rows the commit tab can select, in `git.changes` order. */
function commitCandidates(workspace) {
  return workspaceChanges(workspace).filter(function (change) {
    return change && typeof change.path === 'string' && change.path !== '';
  });
}

function commitCandidatePaths(workspace) {
  return commitCandidates(workspace).map(function (change) {
    return change.path;
  });
}

/** Stable signature used to reseed the checkbox selection when changes move. */
function commitSelectionSignature(workspace) {
  return commitCandidatePaths(workspace).join('\u0000');
}

/** Keep remembered selections that still exist; new changes start selected. */
function reconcileCommitSelection(workspace, previousSelection) {
  var paths = commitCandidatePaths(workspace);
  if (!Array.isArray(previousSelection) || previousSelection.length === 0) return paths;
  var known = new Set(previousSelection);
  return paths.filter(function (path) {
    return known.has(path);
  });
}

function isCommitMessageEmpty(message) {
  return String(message === null || message === undefined ? '' : message).trim() === '';
}

/**
 * Guard for the commit action: an empty message or an empty selection returns
 * the localized error string; a ready request returns ''.
 */
function commitRequestError(t, message, files) {
  if (isCommitMessageEmpty(message)) return t('commit.emptyMessage');
  if (!Array.isArray(files) || files.length === 0) return t('commit.noFiles');
  return '';
}

// ------------------------------------------------------------ wire args

function sessionArg(sessionId) {
  return String(sessionId === null || sessionId === undefined ? '' : sessionId);
}

function workspaceArgs(sessionId) {
  return { session: sessionArg(sessionId) };
}

function gitLogArgs(sessionId, file) {
  var args = workspaceArgs(sessionId);
  if (file) args.file = String(file);
  return args;
}

function previewOpenArgs(sessionId, file) {
  var args = workspaceArgs(sessionId);
  if (file) args.file = String(file);
  return args;
}

function gitSwitchArgs(sessionId, branch, options) {
  var args = { session: sessionArg(sessionId), branch: String(branch === null || branch === undefined ? '' : branch) };
  if (options && options.stash === true) args.options = { stash: true };
  return args;
}

function gitRestoreFileArgs(sessionId, file, commit) {
  return {
    session: sessionArg(sessionId),
    file: String(file === null || file === undefined ? '' : file),
    commit: String(commit === null || commit === undefined ? '' : commit),
  };
}

function gitCommitArgs(sessionId, message, files) {
  var args = {
    session: sessionArg(sessionId),
    message: String(message === null || message === undefined ? '' : message).trim().slice(0, COMMIT_MESSAGE_MAX),
  };
  if (Array.isArray(files) && files.length > 0) {
    args.files = files.map(function (file) {
      return String(file);
    });
  }
  return args;
}

function watchPollArgs(sessionId) {
  return workspaceArgs(sessionId);
}

/** Latest changed paths from one `watchPoll` response (bounded by the Host). */
function watchChangedPaths(result) {
  if (!result || !Array.isArray(result.changed)) return [];
  return result.changed
    .slice(-WATCH_CHANGED_LIMIT)
    .map(function (entry) {
      return entry && entry.path ? String(entry.path) : '';
    })
    .filter(function (path) {
      return path !== '';
    });
}
