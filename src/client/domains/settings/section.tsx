// @ts-nocheck
/**
 * Settings → 轻推（Nudge）page.
 *
 * Product-level preferences rather than build knobs:
 *
 *   通用       plugin UI language (follow DSH / 中文 / English)
 *   功能        annotation, editing, DOM tree, workspace versions, hot reload
 *   右键菜单    Nudge's link-menu and browser-tab-menu contributions
 *   关于与更新   version, build time, git state, plugin path, update check
 *
 * Persistence still goes through the Host `nudge/*` remote backed by DSH's
 * `configEditor` (the profile `cordis.patch.yml` row); switching a control
 * saves immediately and mirrors the result into the Client config store so the
 * toolbar reacts without a plugin reload. All styling reads the shell's
 * `--dsw-alias-*` tokens, so Light / Dark follow the host theme.
 */

var SETTINGS_SECTION_ID = 'nudge-config';
var SETTINGS_SECTION_ORDER = 70;

var SETTINGS_FEATURE_ROWS = [
  { key: 'enableAnnotate', label: 'settings.featureAnnotate', hint: 'settings.featureAnnotateHint' },
  { key: 'enableEdit', label: 'settings.featureEdit', hint: 'settings.featureEditHint' },
  { key: 'enableDomTree', label: 'settings.featureDomTree', hint: 'settings.featureDomTreeHint' },
  { key: 'enableWorkspaceVersions', label: 'settings.featureWorkspaceVersions', hint: 'settings.featureWorkspaceVersionsHint' },
  { key: 'enableFloatingComposer', label: 'settings.featureFloatingComposer', hint: 'settings.featureFloatingComposerHint' },
  { key: 'enableHotReload', label: 'settings.featureHotReload', hint: 'settings.featureHotReloadHint' },
]

var SETTINGS_CONTEXT_MENU_ROWS = [
  { key: 'contextMenuLink', label: 'settings.contextMenuLink', hint: 'settings.contextMenuLinkHint' },
  { key: 'contextMenuTab', label: 'settings.contextMenuTab', hint: 'settings.contextMenuTabHint' },
]

function settingsFormStyle() {
  return {
    maxWidth: 760,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    color: 'var(--dsw-alias-label-primary)',
    font: '13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
  }
}

function settingsCardStyle() {
  return {
    border: '.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2))',
    borderRadius: 'var(--dsw-radius-xl, 12px)',
    background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1))',
    display: 'flex',
    flexDirection: 'column',
    padding: '4px 16px',
  }
}

function settingsSectionTitleStyle() {
  return {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--dsw-alias-label-secondary)',
    padding: '14px 0 6px',
    letterSpacing: '.02em',
  }
}

function settingsRowStyle(last) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    padding: '12px 0',
    borderBottom: last ? 'none' : '.5px solid var(--dsw-alias-border-l2)',
  }
}

function settingsHintStyle() {
  return {
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: '18px',
    marginTop: 2,
  }
}

function settingsMonoStyle() {
  return {
    font: '12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: 'var(--dsw-alias-label-secondary)',
    wordBreak: 'break-all',
    textAlign: 'right',
  }
}

function settingsButtonStyle(primary, disabled) {
  if (primary) {
    return {
      height: 30,
      border: 'none',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'var(--dsw-alias-state-business-primary, #0069fb)',
      color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
      font: 'inherit',
      fontWeight: 500,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      padding: '0 14px',
    }
  }
  return {
    height: 30,
    border: '.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    padding: '0 12px',
  }
}

function settingsSwitchStyle(checked) {
  return {
    width: 36,
    height: 20,
    flex: 'none',
    padding: 0,
    border: 'none',
    borderRadius: 999,
    background: checked
      ? 'var(--dsw-alias-state-business-primary, #0069fb)'
      : 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.32))',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 120ms ease',
  }
}

function settingsKnobStyle(checked) {
  return {
    position: 'absolute',
    top: 2,
    left: checked ? 18 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(0,0,0,.24)',
    transition: 'left 120ms ease',
  }
}

function settingsSegmentedStyle(active, disabled) {
  return {
    height: 28,
    padding: '0 12px',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    border: active
      ? '.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 50%, transparent)'
      : '.5px solid var(--dsw-alias-border-l3)',
    background: active
      ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 12%, transparent)'
      : 'transparent',
    color: active ? 'var(--dsw-alias-state-business-primary, #0069fb)' : 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

function settingsFormatTime(value) {
  var time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  var date = new Date(time);
  var pad = function (part) {
    return part < 10 ? '0' + part : String(part);
  };
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

function settingsFeatureValue(config, key) {
  return config !== null && config.values !== null && config.values[key] !== false;
}

function settingsAbout(about, key) {
  return about !== null && about[key] !== undefined ? about[key] : undefined;
}

/**
 * The plugin's Settings page.
 * @param props Section props: the locale reader plus the Client context.
 */
function NudgeSettingsSection(props) {
  var t = props.t;
  var ctx = props.ctx;
  var h = React.createElement;
  var remoteRef = React.useRef(null);
  if (remoteRef.current === null) remoteRef.current = createRemote(ctx);
  var call = remoteRef.current;

  var configState = React.useState(null);
  var config = configState[0];
  var setConfig = configState[1];
  var statusState = React.useState('loading');
  var status = statusState[0];
  var setStatus = statusState[1];
  var messageState = React.useState('');
  var message = messageState[0];
  var setMessage = messageState[1];
  var aboutState = React.useState(null);
  var about = aboutState[0];
  var setAbout = aboutState[1];
  var aboutErrorState = React.useState('');
  var aboutError = aboutErrorState[0];
  var setAboutError = aboutErrorState[1];
  var checkingState = React.useState(false);
  var checking = checkingState[0];
  var setChecking = checkingState[1];
  var updateState = React.useState(null);
  var update = updateState[0];
  var setUpdate = updateState[1];
  var aliveRef = React.useRef(true);

  React.useEffect(function () {
    aliveRef.current = true;
    return function () {
      aliveRef.current = false;
    };
  }, []);

  var load = React.useCallback(
    function () {
      return call('config').then(
        function (next) {
          if (!aliveRef.current) return;
          setConfig(next);
          setStatus('ready');
        },
        function (error) {
          if (!aliveRef.current) return;
          setStatus('error');
          setMessage(
            t('settings.loadFailed', { message: String(error && error.message ? error.message : error) }) +
              ' ' +
              t('settings.reloadHint'),
          );
        },
      );
    },
    [call, t],
  );

  var loadAbout = React.useCallback(
    function () {
      return call('about', { check: false }).then(
        function (next) {
          if (!aliveRef.current) return;
          setAbout(next);
          setAboutError('');
        },
        function (error) {
          if (!aliveRef.current) return;
          setAboutError(String(error && error.message ? error.message : error));
        },
      );
    },
    [call],
  );

  React.useEffect(function () {
    load();
    loadAbout();
  }, [load, loadAbout]);

  /** Save one patch and mirror the accepted values into the Client store. */
  function persist(patch, previousValues) {
    if (config === null || config.writable !== true || status === 'saving') return;
    setStatus('saving');
    setMessage('');
    call('configUpdate', { patch: patch }).then(
      function (result) {
        if (!aliveRef.current) return;
        var values = result && result.values ? result.values : config.values;
        var accepted = {};
        Object.keys(values).forEach(function (key) {
          accepted[key] = values[key];
        });
        setPluginConfig(accepted, null);
        setConfig(function (previous) {
          if (previous === null) return previous;
          var overridden = Array.isArray(previous.overridden) ? previous.overridden.slice() : [];
          Object.keys(patch).forEach(function (key) {
            if (overridden.indexOf(key) === -1) overridden.push(key);
          });
          return Object.assign({}, previous, { values: accepted, overridden: overridden });
        });
        setStatus('ready');
        setMessage(t('settings.saved'));
      },
      function (error) {
        if (!aliveRef.current) return;
        // Re-read instead of guessing: the Loader may re-apply the Host row
        // while this write is in flight.
        setConfig(function (previous) {
          if (previous === null) return previous;
          return Object.assign({}, previous, { values: Object.assign({}, previous.values, previousValues || {}) });
        });
        setPluginConfig(previousValues || {}, null);
        setStatus('error');
        setMessage(t('settings.saveFailed', { message: String(error && error.message ? error.message : error) }));
      },
    );
  }

  function updateBoolean(key, value) {
    if (config === null || config.writable !== true || status === 'saving') return;
    var previousValues = {};
    previousValues[key] = settingsFeatureValue(config, key);
    if (previousValues[key] === value) return;
    var optimistic = Object.assign({}, config.values);
    optimistic[key] = value;
    setConfig(function (previous) {
      if (previous === null) return previous;
      return Object.assign({}, previous, { values: optimistic });
    });
    setPluginConfig(optimistic, null);
    var patch = {};
    patch[key] = value;
    persist(patch, previousValues);
  }

  function updateLanguage(value) {
    if (config === null || config.writable !== true || status === 'saving') return;
    var previousValues = { language: config.values.language };
    if (previousValues.language === value) return;
    var optimistic = Object.assign({}, config.values);
    optimistic.language = value;
    setConfig(function (previous) {
      if (previous === null) return previous;
      return Object.assign({}, previous, { values: optimistic });
    });
    setPluginConfig(optimistic, null);
    persist({ language: value }, previousValues);
  }

  function restoreDefaults() {
    if (config === null || config.writable !== true || status === 'saving') return;
    var patch = {};
    Object.keys(config.defaults).forEach(function (key) {
      patch[key] = config.defaults[key];
    });
    setStatus('saving');
    setMessage('');
    call('configUpdate', { patch: patch }).then(
      function (result) {
        if (!aliveRef.current) return;
        var values = result && result.values ? result.values : config.defaults;
        setPluginConfig(values, null);
        setConfig(function (previous) {
          if (previous === null) return previous;
          return Object.assign({}, previous, { values: values, overridden: [] });
        });
        setStatus('ready');
        setMessage(t('settings.resetDone'));
      },
      function (error) {
        if (!aliveRef.current) return;
        setStatus('error');
        setMessage(t('settings.saveFailed', { message: String(error && error.message ? error.message : error) }));
      },
    );
  }

  function checkUpdates() {
    if (checking) return;
    setChecking(true);
    setUpdate({ status: 'checking' });
    call('about', { check: true }).then(
      function (next) {
        if (!aliveRef.current) return;
        setChecking(false);
        if (next && next.git !== undefined) setAbout(next);
        setUpdate((next && next.update) || { status: 'error', message: 'empty response' });
      },
      function (error) {
        if (!aliveRef.current) return;
        setChecking(false);
        setUpdate({ status: 'error', message: String(error && error.message ? error.message : error) });
      },
    );
  }

  function switchControl(key, labelKey, hintKey, last) {
    var checked = settingsFeatureValue(config, key);
    var disabled = config === null || config.writable !== true || status === 'saving';
    return h(
      'div',
      { key: key, style: settingsRowStyle(last) },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('span', { style: { fontWeight: 500 } }, t(labelKey)),
        h('span', { style: settingsHintStyle() }, t(hintKey)),
      ),
      h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked === true,
          'aria-label': t(labelKey),
          disabled: disabled,
          onClick: function () {
            updateBoolean(key, !checked);
          },
          style: settingsSwitchStyle(checked === true),
        },
        h('span', { 'aria-hidden': 'true', style: settingsKnobStyle(checked === true) }),
      ),
    );
  }

  function languageRow() {
    var current = config !== null && config.values !== null ? config.values.language : 'auto';
    var disabled = config === null || config.writable !== true || status === 'saving';
    var options = [
      { value: 'auto', label: t('settings.languageAuto') },
      { value: 'zh', label: t('settings.languageZh') },
      { value: 'en', label: t('settings.languageEn') },
    ];
    return h(
      'div',
      { style: settingsRowStyle(false) },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('span', { style: { fontWeight: 500 } }, t('settings.language')),
        h('span', { style: settingsHintStyle() }, t('settings.languageHint')),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
        options.map(function (option) {
          return h(
            'button',
            {
              key: option.value,
              type: 'button',
              'aria-pressed': current === option.value,
              disabled: disabled,
              onClick: function () {
                updateLanguage(option.value);
              },
              style: settingsSegmentedStyle(current === option.value, disabled),
            },
            option.label,
          );
        }),
      ),
    );
  }

  function infoRow(labelKey, value, last) {
    return h(
      'div',
      { style: settingsRowStyle(last) },
      h('span', { style: { flex: 'none', color: 'var(--dsw-alias-label-secondary)' } }, t(labelKey)),
      h('span', { style: settingsMonoStyle() }, value === undefined || value === null || value === '' ? '—' : String(value)),
    );
  }

  function aboutCard() {
    var version = settingsAbout(about, 'version') || '—';
    var builds = about !== null && Array.isArray(about.builds) ? about.builds : [];
    var newest = 0;
    builds.forEach(function (entry) {
      if (entry && typeof entry.mtime === 'number' && entry.mtime > newest) newest = entry.mtime;
    });
    var git = about !== null ? about.git : null;
    var gitText = '—';
    if (git !== null && git !== undefined && git.available === true) {
      gitText =
        t('settings.aboutGitBranch', {
          branch: String(git.branch || '?'),
          commit: String(git.commit || '?'),
        }) + (git.dirty === true ? ' · ' + t('settings.aboutGitDirty') : '');
    } else if (git !== null && git !== undefined) {
      gitText = t('settings.aboutGitUnavailable');
    }
    var runtime = settingsAbout(about, 'runtime');
    var runtimeText = runtime && runtime.node ? 'Node ' + runtime.node + ' · ' + String(runtime.platform || '') + '/' + String(runtime.arch || '') : '—';
    var updateText = '';
    var updateTone = 'secondary';
    if (update === null) {
      updateText = t('settings.updateUnchecked');
    } else if (update.status === 'checking') {
      updateText = t('settings.checking');
    } else if (update.status === 'current') {
      updateText = t('settings.updateCurrent');
    } else if (update.status === 'available') {
      updateText = t('settings.updateAvailable', { version: String(update.latest || '') });
    } else if (update.status === 'unavailable') {
      updateText = t('settings.updateUnavailable');
    } else if (update.status === 'error') {
      updateText = t('settings.updateFailed', { message: String(update.message || '') });
      updateTone = 'error';
    }
    return h(
      'div',
      { style: Object.assign(settingsCardStyle(), { padding: '4px 16px 12px' }) },
      infoRow('settings.aboutVersion', version, false),
      infoRow('settings.aboutBuild', settingsFormatTime(newest), false),
      infoRow('settings.aboutGit', gitText, false),
      infoRow('settings.aboutRuntime', runtimeText, false),
      infoRow('settings.aboutPath', settingsAbout(about, 'pluginRoot') || '—', true),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingTop: 10,
          },
        },
        h(
          'button',
          {
            type: 'button',
            disabled: checking,
            onClick: checkUpdates,
            style: settingsButtonStyle(false, checking),
          },
          checking ? t('settings.checking') : t('settings.checkUpdate'),
        ),
        h(
          'span',
          {
            style: {
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color:
                updateTone === 'error'
                  ? 'var(--dsw-alias-state-error-primary)'
                  : 'var(--dsw-alias-label-secondary)',
            },
          },
          updateText,
        ),
      ),
      h('div', { style: Object.assign(settingsHintStyle(), { paddingTop: 8 }) }, t('settings.updateHint')),
      aboutError ? h('div', { style: Object.assign(settingsHintStyle(), { paddingTop: 4, color: 'var(--dsw-alias-state-error-primary)' }) }, t('settings.aboutFailed', { message: aboutError })) : null,
    );
  }

  if (status === 'loading' && config === null) {
    return h('div', { style: settingsFormStyle() }, t('settings.loading'));
  }

  var readOnly = config !== null && config.writable !== true;
  var busy = status === 'saving';

  return h(
    'div',
    { 'data-dsh-nudge-settings': '', style: settingsFormStyle() },
    readOnly ? h('div', { style: settingsHintStyle() }, t('settings.readOnly')) : null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('div', { style: { flex: 1, minWidth: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('settings.productIntro')),
      h(
        'button',
        {
          type: 'button',
          disabled: config === null || readOnly || busy,
          onClick: restoreDefaults,
          style: settingsButtonStyle(false, config === null || readOnly || busy),
        },
        t('settings.reset'),
      ),
    ),
    message
      ? h(
          'div',
          {
            role: 'status',
            style: {
              fontSize: 12,
              color: status === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
            },
          },
          message,
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: settingsSectionTitleStyle() }, t('settings.sectionGeneral')),
      h('div', { style: settingsCardStyle() }, languageRow()),
      h('div', { style: settingsSectionTitleStyle() }, t('settings.sectionFeatures')),
      h(
        'div',
        { style: settingsCardStyle() },
        SETTINGS_FEATURE_ROWS.map(function (row, index) {
          return switchControl(row.key, row.label, row.hint, index === SETTINGS_FEATURE_ROWS.length - 1);
        }),
      ),
      h('div', { style: settingsSectionTitleStyle() }, t('settings.sectionContextMenu')),
      h(
        'div',
        { style: settingsCardStyle() },
        SETTINGS_CONTEXT_MENU_ROWS.map(function (row, index) {
          return switchControl(row.key, row.label, row.hint, index === SETTINGS_CONTEXT_MENU_ROWS.length - 1);
        }),
      ),
      h('div', { style: settingsSectionTitleStyle() }, t('settings.sectionAbout')),
      aboutCard(),
    ),
  );
}
