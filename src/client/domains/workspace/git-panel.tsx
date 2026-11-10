// @ts-nocheck
/**
 * Docked workspace-versions panel: 文件 / 版本 / 提交.
 *
 * Files tab scans the session workspace's HTML files and opens one through the
 * Host static preview server. Versions tab shows the repository branches and
 * the commit history of the active file with a two-step whole-file restore.
 * Commit tab selects changed files, takes a message and commits them.
 *
 * The panel owns no carrier: open/switch/restore report success through
 * `props.onNavigate` + `props.onReload`, and the inspector body performs the
 * actual page load / reload. Every string is locale-driven; the layout reuses
 * the DomTreePanel surface language (300px aside, header, themed tokens).
 *
 * Contract: docs/workspace-versions.md section 3.
 */

var WORKSPACE_PANEL_TABS = [
  { id: 'files', labelKey: 'workspace.tabs.files' },
  { id: 'versions', labelKey: 'workspace.tabs.versions' },
  { id: 'commit', labelKey: 'workspace.tabs.commit' },
];

/** Narrow error text adapter shared by every rejected bridge call. */
function workspaceErrorMessage(failure) {
  return String(failure && failure.message ? failure.message : failure === null || failure === undefined ? '' : failure);
}

function workspaceShortHash(hash) {
  var text = String(hash === null || hash === undefined ? '' : hash);
  return text.length > 7 ? text.slice(0, 7) : text;
}

function workspacePanelInputStyle(theme) {
  return inputStyle(theme, {
    height: 28,
    font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
  });
}

function workspacePanelRowStyle(theme, active) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    minHeight: 26,
    boxSizing: 'border-box',
    padding: '0 8px',
    border: 'none',
    borderRadius: 5,
    background: active ? 'color-mix(in srgb, ' + (theme.accent || theme.brand) + ' 14%, transparent)' : 'transparent',
    color: theme.text,
    font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    textAlign: 'left',
    cursor: 'pointer',
  };
}

function workspacePanelMutedStyle(theme, extra) {
  return Object.assign(
    {
      color: theme.muted,
      font: 'var(--dsw-font-xxxs-11, 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    },
    extra || {},
  );
}

function workspacePanelButtonStyle(theme, primary) {
  if (primary) {
    return {
      height: 26,
      padding: '0 10px',
      border: 'none',
      borderRadius: 6,
      background: theme.brand,
      color: theme.onBrand || theme.base,
      font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
      fontWeight: 600,
      cursor: 'pointer',
      flex: 'none',
    };
  }
  return {
    height: 26,
    padding: '0 10px',
    border: '1px solid ' + (theme.borderStrong || theme.border),
    borderRadius: 6,
    background: 'transparent',
    color: theme.text,
    font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    cursor: 'pointer',
    flex: 'none',
  };
}

function workspacePanelSectionTitleStyle(theme) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '8px 10px 4px',
    color: theme.muted,
    font: 'var(--dsw-font-xxxs-11, 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    fontWeight: 600,
    letterSpacing: '.02em',
  };
}

function NudgeWorkspacePanel(props) {
  var t = props.t;
  var theme = props.theme;
  var sessionId = props.sessionId || '';
  var refreshToken = typeof props.refreshToken === 'number' ? props.refreshToken : 0;
  var h = React.createElement;

  var remoteRef = React.useRef(null);
  if (remoteRef.current === null) remoteRef.current = createRemote(props.ctx);
  var call = remoteRef.current;

  var aliveRef = React.useRef(true);
  var selectionRef = React.useRef({ sig: null, paths: [] });
  var logSeqRef = React.useRef(0);

  var snapshotState = React.useState(null);
  var snapshot = snapshotState[0];
  var setSnapshot = snapshotState[1];
  var statusState = React.useState('loading');
  var status = statusState[0];
  var setStatus = statusState[1];
  var tabState = React.useState('files');
  var activeTab = tabState[0];
  var setActiveTab = tabState[1];
  var logState = React.useState(null);
  var log = logState[0];
  var setLog = logState[1];
  var logLoadingState = React.useState(false);
  var logLoading = logLoadingState[0];
  var setLogLoading = logLoadingState[1];
  var logRefreshState = React.useState(0);
  var logRefresh = logRefreshState[0];
  var setLogRefresh = logRefreshState[1];
  var filterState = React.useState('');
  var filter = filterState[0];
  var setFilter = filterState[1];
  var explicitFileState = React.useState('');
  var explicitFile = explicitFileState[0];
  var setExplicitFile = explicitFileState[1];
  var branchOfferState = React.useState('');
  var branchOffer = branchOfferState[0];
  var setBranchOffer = branchOfferState[1];
  var restoreArmedState = React.useState('');
  var restoreArmed = restoreArmedState[0];
  var setRestoreArmed = restoreArmedState[1];
  var messageState = React.useState('');
  var message = messageState[0];
  var setMessage = messageState[1];
  var busyState = React.useState('');
  var busy = busyState[0];
  var setBusy = busyState[1];
  var errorState = React.useState('');
  var error = errorState[0];
  var setError = errorState[1];
  var selectionTickState = React.useState(0);
  var setSelectionTick = selectionTickState[1];

  React.useEffect(function () {
    aliveRef.current = true;
    return function () {
      aliveRef.current = false;
    };
  }, []);

  var applySnapshot = React.useCallback(function (next) {
    setSnapshot(next || {});
    setStatus('ready');
    var workspace = next || {};
    var signature = commitSelectionSignature(workspace);
    if (selectionRef.current.sig !== signature) {
      selectionRef.current = {
        sig: signature,
        paths: reconcileCommitSelection(workspace, selectionRef.current.paths),
      };
    }
  }, []);

  var loadWorkspace = React.useCallback(
    function (silent) {
      if (sessionId === '') {
        setStatus('ready');
        return Promise.resolve(null);
      }
      if (silent !== true) setStatus('loading');
      return call('workspace', workspaceArgs(sessionId)).then(
        function (next) {
          if (!aliveRef.current) return null;
          applySnapshot(next);
          return next;
        },
        function (failure) {
          if (!aliveRef.current) return null;
          setStatus('error');
          setError(t('workspace.loadFailed', { message: workspaceErrorMessage(failure) }));
          return null;
        },
      );
    },
    [call, sessionId, applySnapshot, t],
  );

  React.useEffect(
    function () {
      loadWorkspace(false);
    },
    [loadWorkspace],
  );

  // The inspector body bumps `refreshToken` after a successful source write.
  // Reload silently so the files / commit tabs reflect the new git state.
  var syncRefreshRef = React.useRef(refreshToken);
  React.useEffect(
    function () {
      if (refreshToken === syncRefreshRef.current) return;
      syncRefreshRef.current = refreshToken;
      if (refreshToken > 0) loadWorkspace(true);
    },
    [refreshToken, loadWorkspace],
  );

  var files = workspaceFiles(snapshot);
  var inferredFile = inferActiveFile(snapshot, props.currentUrl);
  var explicitExists =
    explicitFile !== '' &&
    files.some(function (file) {
      return file && file.path === explicitFile;
    });
  var activeFile = explicitExists ? explicitFile : inferredFile && inferredFile.path ? inferredFile.path : '';
  var git = workspaceGit(snapshot);
  var writable = workspaceWritable(snapshot);
  var changes = commitCandidates(snapshot);
  var selectedPaths = selectionRef.current.paths;

  var loadLog = React.useCallback(
    function () {
      if (sessionId === '' || activeTab !== 'versions') return Promise.resolve(null);
      logSeqRef.current += 1;
      var seq = logSeqRef.current;
      setLogLoading(true);
      return call('gitLog', gitLogArgs(sessionId, activeFile || undefined)).then(
        function (result) {
          if (!aliveRef.current || logSeqRef.current !== seq) return null;
          setLog(result || { file: activeFile || '', commits: [] });
          setLogLoading(false);
          return result;
        },
        function (failure) {
          if (!aliveRef.current || logSeqRef.current !== seq) return null;
          setLog({ file: activeFile || '', commits: [] });
          setLogLoading(false);
          setError(t('workspace.versionsFailed', { message: workspaceErrorMessage(failure) }));
          return null;
        },
      );
    },
    [call, sessionId, activeTab, activeFile, t],
  );

  React.useEffect(
    function () {
      loadLog();
    },
    [loadLog, logRefresh],
  );

  function report(tone, text) {
    if (typeof props.onNotice === 'function') props.onNotice({ tone: tone, text: text });
  }

  function refresh() {
    setError('');
    loadWorkspace(true);
    if (activeTab === 'versions') setLogRefresh(logRefresh + 1);
  }

  function selectTab(next) {
    setActiveTab(next);
    setError('');
    setBranchOffer('');
    setRestoreArmed('');
    if (next === 'versions') setLogRefresh(logRefresh + 1);
  }

  // ------------------------------------------------------------- open file

  function openFile(file) {
    if (!file || sessionId === '' || busy !== '') return;
    setError('');
    setBusy('open');
    call('previewOpen', previewOpenArgs(sessionId, file.path)).then(
      function (result) {
        if (!aliveRef.current) return;
        setBusy('');
        if (!result || !result.url) {
          setError(t('workspace.openFailed', { message: 'previewOpen' }));
          return;
        }
        setExplicitFile(file.path);
        // The body's navigate() already loads the new URL through the carrier,
        // so opening a file only navigates. An explicit reload here would race
        // that load and could reload the previous page; switch/restore still
        // reload because they change the bytes behind the current URL.
        if (typeof props.onNavigate === 'function') props.onNavigate(result.url);
      },
      function (failure) {
        if (!aliveRef.current) return;
        setBusy('');
        setError(t('workspace.openFailed', { message: workspaceErrorMessage(failure) }));
      },
    );
  }

  // ------------------------------------------------------------- branches

  function switchBranch(branch) {
    if (busy !== '' || !writable) return;
    if (workspaceIsDirty(snapshot)) {
      setBranchOffer(branch);
      return;
    }
    performSwitch(branch, false);
  }

  function performSwitch(branch, stash) {
    if (busy !== '' || !writable) return;
    setError('');
    setBranchOffer('');
    setBusy('switch');
    call('gitSwitch', gitSwitchArgs(sessionId, branch, { stash: stash === true })).then(
      function (result) {
        if (!aliveRef.current) return;
        setBusy('');
        if (result && result.ok === true) {
          report(
            'success',
            result.stashed === true
              ? t('workspace.stashedSwitched', { branch: branch })
              : t('workspace.switched', { branch: branch }),
          );
          loadWorkspace(true);
          if (typeof props.onReload === 'function') props.onReload();
          return;
        }
        if (result && result.reason === 'dirty') {
          setBranchOffer(branch);
          setError(t('workspace.switchDirty'));
          return;
        }
        setError(t('workspace.switchFailed', { message: (result && result.message) || '' }));
      },
      function (failure) {
        if (!aliveRef.current) return;
        setBusy('');
        setError(t('workspace.switchFailed', { message: workspaceErrorMessage(failure) }));
      },
    );
  }

  // ------------------------------------------------------------- restore

  function requestRestore(commit) {
    if (busy !== '' || !writable || activeFile === '') return;
    setRestoreArmed(commit);
  }

  function confirmRestore(commit) {
    if (busy !== '' || !writable || activeFile === '') return;
    setBusy('restore');
    setError('');
    call('gitRestoreFile', gitRestoreFileArgs(sessionId, activeFile, commit)).then(
      function () {
        if (!aliveRef.current) return;
        setBusy('');
        setRestoreArmed('');
        report('success', t('workspace.restored', { file: workspacePathName(activeFile), commit: workspaceShortHash(commit) }));
        loadWorkspace(true);
        if (typeof props.onReload === 'function') props.onReload();
      },
      function (failure) {
        if (!aliveRef.current) return;
        setBusy('');
        setRestoreArmed('');
        setError(t('workspace.restoreFailed', { message: workspaceErrorMessage(failure) }));
      },
    );
  }

  // ------------------------------------------------------------- commit

  function toggleCommitFile(path) {
    var previous = selectionRef.current.paths.slice();
    var index = previous.indexOf(path);
    if (index === -1) previous.push(path);
    else previous.splice(index, 1);
    var known = new Set(previous);
    selectionRef.current = {
      sig: selectionRef.current.sig,
      paths: commitCandidatePaths(snapshot).filter(function (candidate) {
        return known.has(candidate);
      }),
    };
    setSelectionTick(function (value) {
      return value + 1;
    });
  }

  function toggleCommitAll() {
    var all = commitCandidatePaths(snapshot);
    selectionRef.current = {
      sig: selectionRef.current.sig,
      paths: selectionRef.current.paths.length === all.length ? [] : all,
    };
    setSelectionTick(function (value) {
      return value + 1;
    });
  }

  function submitCommit() {
    if (busy !== '' || !writable) return;
    var filesToCommit = selectionRef.current.paths.slice();
    var guard = commitRequestError(t, message, filesToCommit);
    if (guard !== '') {
      setError(guard);
      return;
    }
    setError('');
    setBusy('commit');
    call('gitCommit', gitCommitArgs(sessionId, message, filesToCommit)).then(
      function (result) {
        if (!aliveRef.current) return;
        setBusy('');
        if (!result || result.ok !== true) {
          setError(t('commit.failed', { message: (result && result.message) || '' }));
          return;
        }
        if (result.committed === false) {
          report('info', t('commit.nothing'));
          loadWorkspace(true);
          return;
        }
        setMessage('');
        report('success', t('commit.done', { commit: result.commit && result.commit.short ? result.commit.short : '' }));
        loadWorkspace(true);
        setLogRefresh(logRefresh + 1);
      },
      function (failure) {
        if (!aliveRef.current) return;
        setBusy('');
        setError(t('commit.failed', { message: workspaceErrorMessage(failure) }));
      },
    );
  }

  // ------------------------------------------------------------- render

  function renderHeader() {
    return h(
      'div',
      {
        style: {
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 34,
          padding: '0 6px 0 10px',
          borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
          color: theme.text,
          font: 'var(--dsw-font-xxxs-11, 11.5px/1.3 sans-serif)',
          fontWeight: 600,
        },
      },
      h(Icon.branch, { size: 13 }),
      h('span', { style: { flex: 1, minWidth: 0 } }, t('workspace.title')),
      h(
        'button',
        {
          type: 'button',
          'aria-label': t('workspace.refresh'),
          title: t('workspace.refresh'),
          onClick: refresh,
          disabled: busy !== '' || sessionId === '',
          style: {
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            borderRadius: 5,
            background: 'transparent',
            color: theme.muted,
            cursor: 'pointer',
            opacity: busy !== '' ? 0.45 : 1,
          },
        },
        h(Icon.reload, { size: 12 }),
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': t('workspace.close'),
          title: t('workspace.close'),
          onClick: function () {
            if (typeof props.onClose === 'function') props.onClose();
          },
          style: {
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            borderRadius: 5,
            background: 'transparent',
            color: theme.muted,
            cursor: 'pointer',
          },
        },
        h(Icon.close, { size: 12 }),
      ),
    );
  }

  function renderRepoSummary() {
    if (sessionId === '') {
      return h('div', { style: workspacePanelMutedStyle(theme, { padding: '8px 10px' }) }, t('workspace.noSession'));
    }
    if (!git || git.available !== true) {
      var reason = git && git.error ? String(git.error) : '';
      return h(
        'div',
        { style: workspacePanelMutedStyle(theme, { padding: '8px 10px' }) },
        t('workspace.gitUnavailable', { reason: reason === '' ? t('workspace.gitNotRepo') : reason }),
      );
    }
    return h(
      'div',
      {
        style: {
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
          color: theme.text,
          font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
        },
      },
      h(Icon.branch, { size: 11 }),
      h(
        'span',
        { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        git.detached === true ? t('workspace.detached') : String(git.branch || ''),
      ),
      h('span', {
        'aria-hidden': true,
        title: workspaceIsDirty(snapshot) ? t('workspace.dirty') : t('workspace.clean'),
        style: {
          width: 6,
          height: 6,
          borderRadius: 999,
          flex: 'none',
          background: workspaceIsDirty(snapshot) ? theme.warn || theme.danger || theme.brand : theme.success || theme.border,
        },
      }),
      h('span', { style: { flex: 1, minWidth: 0 } }),
      !writable
        ? h('span', { style: { color: theme.muted, fontSize: 10.5 } }, t('workspace.readOnly'))
        : h(
            'span',
            { style: { color: workspaceIsDirty(snapshot) ? theme.warn || theme.danger : theme.muted, fontSize: 10.5 } },
            workspaceIsDirty(snapshot) ? t('workspace.dirty') : t('workspace.clean'),
          ),
    );
  }

  function renderTabs() {
    return h(
      'div',
      {
        role: 'tablist',
        style: {
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 6px',
          borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
        },
      },
      WORKSPACE_PANEL_TABS.map(function (tab) {
        var active = activeTab === tab.id;
        return h(
          'button',
          {
            key: tab.id,
            type: 'button',
            role: 'tab',
            'aria-pressed': active,
            'aria-selected': active,
            'data-workspace-tab': tab.id,
            onClick: function () {
              selectTab(tab.id);
            },
            style: {
              flex: 1,
              height: 26,
              padding: 0,
              border: 'none',
              borderRadius: 5,
              background: active ? (theme.hover || theme.layer2) : 'transparent',
              color: active ? theme.text : theme.muted,
              font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
            },
          },
          t(tab.labelKey),
        );
      }),
    );
  }

  function renderFileRow(file) {
    var path = String(file.path || '');
    var dir = file.dir !== undefined ? String(file.dir) : workspacePathDir(path);
    var change = file.change ? String(file.change) : '';
    var name = file.name ? String(file.name) : workspacePathName(path);
    var active = activeFile === path;
    return h(
      'button',
      {
        key: 'file:' + path,
        type: 'button',
        'data-workspace-file': path,
        'aria-pressed': active,
        title: path,
        onClick: function () {
          openFile(file);
        },
        style: workspacePanelRowStyle(theme, active),
        onMouseEnter: function (event) {
          if (!active) event.currentTarget.style.background = theme.hover || theme.layer2;
        },
        onMouseLeave: function (event) {
          if (!active) event.currentTarget.style.background = 'transparent';
        },
      },
      h(Icon.file, { size: 11 }),
      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
      dir !== ''
        ? h(
            'span',
            { style: { flex: 'none', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.faint || theme.muted, fontSize: 10.5 } },
            dir,
          )
        : null,
      change !== ''
        ? h(
            'span',
            {
              'data-workspace-change': change,
              style: {
                flex: 'none',
                padding: '0 4px',
                borderRadius: 4,
                background: 'color-mix(in srgb, ' + (theme.warn || theme.brand) + ' 14%, transparent)',
                color: theme.warn || theme.muted,
                fontSize: 10,
                lineHeight: '16px',
              },
            },
            changeLabelText(t, change),
          )
        : null,
    );
  }

  function renderFilesTab() {
    var visible = filterWorkspaceFiles(files, filter);
    var rows = [];
    rows.push(
      h('div', { key: 'filter', style: { padding: '8px 8px 4px' } }, h('input', {
        type: 'search',
        value: filter,
        placeholder: t('workspace.filterPlaceholder'),
        'aria-label': t('workspace.filterPlaceholder'),
        onChange: function (event) {
          setFilter(event && event.target ? event.target.value : '');
        },
        style: workspacePanelInputStyle(theme),
      })),
    );
    rows.push(
      h(
        'div',
        { key: 'count', style: workspacePanelMutedStyle(theme, { padding: '2px 10px 4px', fontSize: 10.5 }) },
        t('workspace.fileCount', { n: String(files.length) }),
        snapshot && snapshot.truncated === true ? ' · ' + t('workspace.truncated') : '',
      ),
    );
    if (visible.length === 0) {
      rows.push(
        h(
          'div',
          { key: 'empty', style: workspacePanelMutedStyle(theme, { padding: '10px 10px' }) },
          files.length === 0 ? t('workspace.noFiles') : t('workspace.noMatches'),
        ),
      );
    }
    visible.forEach(function (file) {
      rows.push(renderFileRow(file));
    });
    return h('div', { 'data-dsh-nudge-workspace-files': '', style: { display: 'flex', flexDirection: 'column', gap: 1 } }, rows);
  }

  function renderBranchSection() {
    if (!git || git.available !== true) return null;
    var branches = workspaceBranches(snapshot);
    if (branches.length === 0) return null;
    var rows = [
      h(
        'div',
        { key: 'branch-title', style: workspacePanelSectionTitleStyle(theme) },
        h(Icon.branch, { size: 11 }),
        t('workspace.branches'),
      ),
    ];
    branches.forEach(function (branch) {
      var name = String(branch && branch.name ? branch.name : '');
      var current = branch && branch.current === true;
      var offered = branchOffer === name;
      rows.push(
        h(
          'div',
          { key: 'branch:' + name, style: { display: 'flex', flexDirection: 'column' } },
          h(
            'button',
            {
              type: 'button',
              'data-workspace-branch': name,
              'aria-pressed': current,
              'aria-label': t('workspace.switchBranch', { branch: name }),
              title: current ? t('workspace.currentBranch') : t('workspace.switchBranch', { branch: name }),
              disabled: current || !writable || busy !== '',
              onClick: function () {
                if (!current) switchBranch(name);
              },
              style: Object.assign(workspacePanelRowStyle(theme, current), {
                cursor: current || !writable ? 'default' : 'pointer',
                opacity: !writable ? 0.55 : 1,
              }),
            },
            h(Icon.branch, { size: 11 }),
            h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
            current ? h(Icon.check, { size: 11 }) : null,
          ),
          offered
            ? h(
                'div',
                {
                  'data-workspace-switch-offer': name,
                  style: {
                    margin: '2px 6px 6px',
                    padding: '7px 8px',
                    borderRadius: 6,
                    border: '1px solid ' + (theme.borderStrong || theme.border),
                    background: 'color-mix(in srgb, ' + (theme.warn || theme.brand) + ' 8%, transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  },
                },
                h('span', { style: workspacePanelMutedStyle(theme) }, t('workspace.switchDirtyHint')),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      'data-workspace-stash-switch': name,
                      onClick: function () {
                        performSwitch(name, true);
                      },
                      style: workspacePanelButtonStyle(theme, true),
                    },
                    t('workspace.stashSwitch'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      'data-workspace-go-commit': '',
                      onClick: function () {
                        setBranchOffer('');
                        selectTab('commit');
                      },
                      style: workspacePanelButtonStyle(theme, false),
                    },
                    t('workspace.goCommit'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      'data-workspace-cancel-switch': '',
                      onClick: function () {
                        setBranchOffer('');
                      },
                      style: workspacePanelButtonStyle(theme, false),
                    },
                    t('workspace.restoreCancel'),
                  ),
                ),
              )
            : null,
        ),
      );
    });
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } }, rows);
  }

  function renderCommitRow(commit) {
    var hash = String(commit && commit.hash ? commit.hash : '');
    var short = commit && commit.short ? String(commit.short) : workspaceShortHash(hash);
    var armed = restoreArmed === hash;
    var canRestore = activeFile !== '' && writable && busy === '';
    return h(
      'div',
      {
        key: 'commit:' + hash + ':' + short,
        'data-workspace-commit-row': short,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '6px 10px',
          borderBottom: '1px solid ' + (theme.border || 'transparent'),
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { color: theme.text, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(commit && commit.subject ? commit.subject : '')),
        h('span', { style: workspacePanelMutedStyle(theme, { flex: 'none', fontSize: 10.5 }) }, short),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h(
          'span',
          { style: workspacePanelMutedStyle(theme, { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5 }) },
          String(commit && commit.author ? commit.author : '') + ' · ' + formatCommitTime(commit && commit.date ? commit.date : ''),
        ),
        canRestore
          ? armed
            ? h(
                'span',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' } },
                h(
                  'button',
                  {
                    type: 'button',
                    'data-workspace-restore-confirm': short,
                    title: t('workspace.restoreHint', { file: activeFile, commit: short }),
                    onClick: function () {
                      confirmRestore(hash);
                    },
                    style: workspacePanelButtonStyle(theme, true),
                  },
                  t('workspace.restoreConfirm'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-workspace-restore-cancel': '',
                    onClick: function () {
                      setRestoreArmed('');
                    },
                    style: workspacePanelButtonStyle(theme, false),
                  },
                  t('workspace.restoreCancel'),
                ),
              )
            : h(
                'button',
                {
                  type: 'button',
                  'data-workspace-restore': short,
                  title: t('workspace.restoreHint', { file: activeFile, commit: short }),
                  onClick: function () {
                    requestRestore(hash);
                  },
                  style: workspacePanelButtonStyle(theme, false),
                },
                t('workspace.restore'),
              )
          : null,
      ),
    );
  }

  function renderVersionsTab() {
    if (!git || git.available !== true) {
      return h('div', { style: workspacePanelMutedStyle(theme, { padding: '10px' }) }, t('workspace.gitUnavailable', { reason: t('workspace.gitNotRepo') }));
    }
    var rows = [renderBranchSection()];
    rows.push(
      h(
        'div',
        { key: 'versions-title', style: workspacePanelSectionTitleStyle(theme) },
        h(Icon.history, { size: 11 }),
        activeFile !== '' ? t('workspace.versionsFor', { file: workspacePathName(activeFile) }) : t('workspace.repoVersions'),
      ),
    );
    if (activeFile === '') {
      rows.push(h('div', { key: 'pick', style: workspacePanelMutedStyle(theme, { padding: '2px 10px 6px' }) }, t('workspace.pickFile')));
    }
    var commits = log && Array.isArray(log.commits) ? log.commits : [];
    if (logLoading && commits.length === 0) {
      rows.push(
        h(
          'div',
          { key: 'loading', style: workspacePanelMutedStyle(theme, { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px' }) },
          h(Spinner, { theme: theme }),
          t('workspace.loading'),
        ),
      );
    } else if (commits.length === 0) {
      rows.push(
        h(
          'div',
          { key: 'empty', style: workspacePanelMutedStyle(theme, { padding: '8px 10px' }) },
          activeFile !== '' ? t('workspace.noVersions') : t('workspace.noRepoVersions'),
        ),
      );
    } else {
      commits.forEach(function (commit) {
        rows.push(renderCommitRow(commit));
      });
    }
    return h('div', { 'data-dsh-nudge-workspace-versions': '', style: { display: 'flex', flexDirection: 'column' } }, rows);
  }

  function renderCommitTab() {
    if (!git || git.available !== true) {
      return h('div', { style: workspacePanelMutedStyle(theme, { padding: '10px' }) }, t('workspace.gitUnavailable', { reason: t('workspace.gitNotRepo') }));
    }
    if (changes.length === 0) {
      return h('div', { style: workspacePanelMutedStyle(theme, { padding: '10px' }) }, t('commit.noChanges'));
    }
    var allSelected = selectedPaths.length === changes.length && changes.length > 0;
    var rows = [
      h(
        'div',
        {
          key: 'select-all',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px 4px',
            borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
          },
        },
        h(
          'button',
          {
            type: 'button',
            'data-workspace-select-all': '',
            'aria-pressed': allSelected,
            disabled: !writable || busy !== '',
            onClick: toggleCommitAll,
            style: workspacePanelButtonStyle(theme, false),
          },
          t('commit.selectAll'),
        ),
        h(
          'span',
          { style: workspacePanelMutedStyle(theme, { flex: '1 1 auto', textAlign: 'right', fontSize: 10.5 }) },
          t('commit.selectedCount', { n: String(selectedPaths.length) }),
        ),
      ),
    ];
    changes.forEach(function (change) {
      var path = String(change.path);
      var checked = selectedPaths.indexOf(path) !== -1;
      rows.push(
        h(
          'label',
          {
            key: 'change:' + path,
            'data-workspace-change-row': path,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 26,
              padding: '0 10px',
              cursor: writable && busy === '' ? 'pointer' : 'default',
              color: theme.text,
              font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
              opacity: writable ? 1 : 0.6,
            },
          },
          h('input', {
            type: 'checkbox',
            checked: checked,
            disabled: !writable || busy !== '',
            'aria-label': path,
            onChange: function () {
              toggleCommitFile(path);
            },
            style: { margin: 0, flex: 'none' },
          }),
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, path),
          h(
            'span',
            { style: workspacePanelMutedStyle(theme, { flex: 'none', fontSize: 10.5 }) },
            changeLabelText(t, change.label),
          ),
        ),
      );
    });
    rows.push(
      h(
        'div',
        { key: 'message', style: { padding: '8px 10px 0' } },
        h('textarea', {
          value: message,
          rows: 3,
          maxLength: COMMIT_MESSAGE_MAX,
          placeholder: t('commit.messagePlaceholder'),
          'aria-label': t('commit.messagePlaceholder'),
          'data-workspace-commit-message': '',
          onChange: function (event) {
            setMessage(event && event.target ? event.target.value : '');
          },
          style: Object.assign(workspacePanelInputStyle(theme), {
            height: 'auto',
            minHeight: 58,
            padding: '5px 7px',
            resize: 'vertical',
            fontFamily: 'inherit',
          }),
        }),
      ),
    );
    rows.push(
      h(
        'div',
        { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 12px' } },
        h(
          'button',
          {
            type: 'button',
            'data-workspace-commit': '',
            disabled: !writable || busy !== '',
            onClick: submitCommit,
            style: Object.assign(workspacePanelButtonStyle(theme, true), {
              opacity: !writable || busy !== '' ? 0.55 : 1,
              cursor: !writable || busy !== '' ? 'default' : 'pointer',
            }),
          },
          busy === 'commit' ? t('commit.committing') : t('commit.commit'),
        ),
        h(
          'span',
          { style: workspacePanelMutedStyle(theme, { flex: '1 1 auto', minWidth: 0 }) },
          t('commit.selectedCount', { n: String(selectedPaths.length) }),
        ),
      ),
    );
    return h('div', { 'data-dsh-nudge-workspace-commit': '', style: { display: 'flex', flexDirection: 'column' } }, rows);
  }

  function renderBody() {
    if (sessionId === '') {
      return h('div', { style: workspacePanelMutedStyle(theme, { padding: '12px 10px' }) }, t('workspace.noSession'));
    }
    if (snapshot === null) {
      if (status === 'error') {
        return h(
          'div',
          { style: { padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 } },
          h('span', { style: { color: theme.danger, fontSize: 11 } }, error),
          h(
            'button',
            { type: 'button', onClick: refresh, style: workspacePanelButtonStyle(theme, false) },
            t('workspace.refresh'),
          ),
        );
      }
      return h(
        'div',
        { style: workspacePanelMutedStyle(theme, { display: 'flex', alignItems: 'center', gap: 6, padding: '12px 10px' }) },
        h(Spinner, { theme: theme }),
        t('workspace.loading'),
      );
    }
    if (activeTab === 'versions') return renderVersionsTab();
    if (activeTab === 'commit') return renderCommitTab();
    return renderFilesTab();
  }

  return h(
    'aside',
    {
      'data-dsh-nudge-workspace-panel': '',
      'aria-label': t('workspace.title'),
      style: {
        width: 300,
        flex: 'none',
        minWidth: 300,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderLeft: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.base,
        color: theme.text,
      },
    },
    renderHeader(),
    renderRepoSummary(),
    renderTabs(),
    error !== ''
      ? h(
          'div',
          { role: 'alert', style: { flex: 'none', padding: '5px 10px', color: theme.danger, background: 'color-mix(in srgb, ' + theme.danger + ' 10%, transparent)', font: 'var(--dsw-font-xxxs-11, 11px/1.4 sans-serif)' } },
          error,
        )
      : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '2px 2px 12px' } },
      renderBody(),
    ),
  );
}
