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

/**
 * Page-local hotkeys the recorder may edit. Values are physical
 * `KeyboardEvent.code` strings; the injected runtime owns their behavior.
 */
var SETTINGS_HOTKEY_ROWS = [
  { key: 'hotkeyAnnotate', label: 'shortcut.enterAnnotate' },
  { key: 'hotkeyEdit', label: 'shortcut.enterEdit' },
  { key: 'hotkeyPrevAnnotation', label: 'shortcut.prevAnnotation' },
  { key: 'hotkeyNextAnnotation', label: 'shortcut.nextAnnotation' },
]

var SETTINGS_HOTKEY_DEFAULTS = {
  hotkeyAnnotate: 'KeyA',
  hotkeyEdit: 'KeyE',
  hotkeyPrevAnnotation: 'ArrowUp',
  hotkeyNextAnnotation: 'ArrowDown',
}

/** Keys the page runtime reserves, so the recorder may never bind them. */
var SETTINGS_HOTKEY_RESERVED = ['Escape', 'Space', 'Tab', 'Enter', 'Backspace', 'Delete']

/** Bare modifier keydowns cannot be a binding and are skipped while recording. */
var SETTINGS_HOTKEY_MODIFIERS = [
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]

/**
 * Recordable physical codes. Mirrors the Host's normalizeConfig whitelist so the
 * page never offers a code the Host would silently reject.
 */
var SETTINGS_HOTKEY_CODE_PATTERN =
  /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Period|Comma|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote)$/

/** Human keycap label for one physical code. */
var SETTINGS_HOTKEY_LABELS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
}

function settingsHotkeyAllowed(code) {
  return typeof code === 'string' && SETTINGS_HOTKEY_CODE_PATTERN.test(code);
}

function settingsHotkeyLabel(code) {
  if (typeof code !== 'string' || code === '') return '—';
  if (SETTINGS_HOTKEY_LABELS[code] !== undefined) return SETTINGS_HOTKEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

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

/**
 * One segmented control group: the three language choices read as a single
 * control instead of three loose buttons, matching the settings shell's
 * selected-pill language while keeping the row's right edge calm.
 */
function settingsSegmentedGroupStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 'none',
    padding: 3,
    boxSizing: 'border-box',
    borderRadius: 'calc(var(--dsw-radius-md, 8px) + 2px)',
    background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.14))',
    border: '.5px solid var(--dsw-alias-border-l2)',
  }
}

function settingsSegmentedStyle(active, disabled) {
  return {
    height: 28,
    minWidth: 62,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 14px',
    boxSizing: 'border-box',
    border: 'none',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    background: active
      ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 16%, transparent)'
      : 'transparent',
    color: active ? 'var(--dsw-alias-state-business-primary, #0069fb)' : 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    boxShadow: active
      ? 'inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 42%, transparent)'
      : 'none',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
  }
}

function settingsHotkeyKeycapStyle(recording, disabled) {
  return {
    height: 30,
    minWidth: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    border: recording
      ? '.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 60%, transparent)'
      : '.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    background: recording
      ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #0069fb) 12%, transparent)'
      : 'transparent',
    color: recording ? 'var(--dsw-alias-state-business-primary, #0069fb)' : 'var(--dsw-alias-label-primary)',
    font: '12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

function settingsHotkeyFixedStyle() {
  return Object.assign(settingsHotkeyKeycapStyle(false, true), {
    cursor: 'default',
    opacity: 1,
    fontWeight: 500,
    color: 'var(--dsw-alias-label-secondary)',
  });
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
  var updatingState = React.useState(false);
  var updating = updatingState[0];
  var setUpdating = updatingState[1];
  // The hotkey recorder: `hotkeyRecording` is the config key currently waiting
  // for a keydown (null when idle), `hotkeyConflict` is the inline rejection.
  var hotkeyRecordingState = React.useState(null);
  var hotkeyRecording = hotkeyRecordingState[0];
  var setHotkeyRecording = hotkeyRecordingState[1];
  var hotkeyConflictState = React.useState('');
  var hotkeyConflict = hotkeyConflictState[0];
  var setHotkeyConflict = hotkeyConflictState[1];
  var aliveRef = React.useRef(true);

  // 设置页打开时 `about` 会带回 Host 缓存的检查快照；手动检查/一键更新后
  // `update` 状态覆盖它，避免重复的挂载 effect 把用户操作结果冲掉。
  var updateView = update !== null ? update : about !== null && about.update !== undefined ? about.update : null;

  React.useEffect(function () {
    aliveRef.current = true;
    return function () {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Recorder key capture. Mounted only while a row is recording, so the page
   * never swallows keys at rest. Physical modifier keydowns are ignored (they
   * cannot be a single-key binding), Escape cancels, and the host-level options
   * / page keys stay reserved. A rejected key keeps the row recording so the
   * user can simply press a different key.
   */
  React.useEffect(function () {
    if (hotkeyRecording === null) return undefined;
    function cancel() {
      setHotkeyRecording(null);
      setHotkeyConflict('');
    }
    function onKeyDown(event) {
      if (event.isComposing === true) return;
      var code = typeof event.code === 'string' ? event.code : '';
      if (SETTINGS_HOTKEY_MODIFIERS.indexOf(code) !== -1) return;
      event.preventDefault();
      event.stopPropagation();
      if (code === 'Escape') {
        cancel();
        return;
      }
      if (SETTINGS_HOTKEY_RESERVED.indexOf(code) !== -1 || !settingsHotkeyAllowed(code)) {
        setHotkeyConflict(t('settings.hotkeyConflict'));
        return;
      }
      var values = config !== null && config.values !== null ? config.values : {};
      for (var index = 0; index < SETTINGS_HOTKEY_ROWS.length; index += 1) {
        var other = SETTINGS_HOTKEY_ROWS[index];
        if (other.key !== hotkeyRecording && values[other.key] === code) {
          setHotkeyConflict(t('settings.hotkeyConflict'));
          return;
        }
      }
      setHotkeyConflict('');
      setHotkeyRecording(null);
      updateHotkey(hotkeyRecording, code);
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cancel);
    return function () {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeyRecording, config, t]);

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
      // 不带 check：Host 返回启动时缓存好的检查快照，设置页打开即显示结果。
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

  /** Persist one recorded hotkey through the same optimistic persist path. */
  function updateHotkey(key, code) {
    if (config === null || config.writable !== true || status === 'saving') return;
    var previousValues = {};
    previousValues[key] = config.values[key];
    if (previousValues[key] === code) return;
    var optimistic = Object.assign({}, config.values);
    optimistic[key] = code;
    setConfig(function (previous) {
      if (previous === null) return previous;
      return Object.assign({}, previous, { values: optimistic });
    });
    setPluginConfig(optimistic, null);
    var patch = {};
    patch[key] = code;
    persist(patch, previousValues);
  }

  /** Start (or stop) recording the pressed key for one row. */
  function toggleHotkeyRecording(key) {
    if (config === null || config.writable !== true || status === 'saving') return;
    setHotkeyConflict('');
    setHotkeyRecording(hotkeyRecording === key ? null : key);
  }

  /** Cancel recording without touching the stored value. */
  function cancelHotkeyRecording() {
    setHotkeyRecording(null);
    setHotkeyConflict('');
  }

  /** Patch the four page-local hotkeys back to their shipped defaults. */
  function restoreHotkeyDefaults() {
    if (config === null || config.writable !== true || status === 'saving') return;
    var currentValues = config.values !== null ? config.values : {};
    var patch = {};
    var previousValues = {};
    var changed = false;
    Object.keys(SETTINGS_HOTKEY_DEFAULTS).forEach(function (key) {
      previousValues[key] = currentValues[key];
      patch[key] = SETTINGS_HOTKEY_DEFAULTS[key];
      if (previousValues[key] !== patch[key]) changed = true;
    });
    if (!changed) return;
    cancelHotkeyRecording();
    var optimistic = Object.assign({}, currentValues);
    Object.keys(patch).forEach(function (key) {
      optimistic[key] = patch[key];
    });
    setConfig(function (previous) {
      if (previous === null) return previous;
      return Object.assign({}, previous, { values: optimistic });
    });
    setPluginConfig(optimistic, null);
    persist(patch, previousValues);
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

  /**
   * 一键更新：调用 Host 的 `nudge/update`，由 DSH pluginManager 从 npm registry
   * 卸载旧版并安装精确新版。只有 Host 判定 update.status==='available' 时按钮才可点。
   */
  function runUpdate() {
    if (updating) return;
    var target = updateView !== null && updateView.latest ? String(updateView.latest) : '';
    if (target === '') return;
    setUpdating(true);
    setUpdate({
      status: 'updating',
      installed: updateView !== null ? updateView.installed : undefined,
      latest: target,
    });
    call('update', { version: target }).then(
      function (result) {
        if (!aliveRef.current) return;
        setUpdating(false);
        var status = result !== null && result !== undefined ? result.status : undefined;
        if (status === 'updated' || status === 'restart-required') {
          var to = result.to ? String(result.to) : target;
          setUpdate({
            status: status,
            installed: to,
            latest: target,
            restart: result.restart === true || status === 'restart-required',
            versions: [],
          });
          // The visible version row should show the version now on disk.
          setAbout(function (previous) {
            if (previous === null) return previous;
            return Object.assign({}, previous, { version: to });
          });
          return;
        }
        setUpdate({
          status: 'error',
          message: String(result && result.message ? result.message : ''),
        });
      },
      function (error) {
        if (!aliveRef.current) return;
        setUpdating(false);
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
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto', maxWidth: 480, paddingRight: 16 } },
        h('span', { style: { fontWeight: 500 } }, t('settings.language')),
        h('span', { style: Object.assign(settingsHintStyle(), { maxWidth: 460 }) }, t('settings.languageHint')),
      ),
      h(
        'div',
        { role: 'group', 'aria-label': t('settings.language'), style: settingsSegmentedGroupStyle() },
        options.map(function (option) {
          var active = current === option.value;
          return h(
            'button',
            {
              key: option.value,
              type: 'button',
              'aria-pressed': active,
              disabled: disabled,
              onClick: function () {
                updateLanguage(option.value);
              },
              onMouseEnter: function (event) {
                if (!active && !disabled) {
                  event.currentTarget.style.background = 'color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)';
                  event.currentTarget.style.color = 'var(--dsw-alias-label-primary)';
                }
              },
              onMouseLeave: function (event) {
                if (!active) {
                  event.currentTarget.style.background = 'transparent';
                  event.currentTarget.style.color = 'var(--dsw-alias-label-secondary)';
                }
              },
              style: settingsSegmentedStyle(active, disabled),
            },
            option.label,
          );
        }),
      ),
    );
  }

  function hotkeyRow(row, last) {
    var values = config !== null && config.values !== null ? config.values : {};
    var current = values[row.key] !== undefined ? values[row.key] : SETTINGS_HOTKEY_DEFAULTS[row.key];
    var recording = hotkeyRecording === row.key;
    var disabled = config === null || config.writable !== true || status === 'saving';
    return h(
      'div',
      { key: row.key, style: settingsRowStyle(last) },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('span', { style: { fontWeight: 500 } }, t(row.label)),
        recording && hotkeyConflict
          ? h(
              'span',
              {
                role: 'status',
                style: Object.assign(settingsHintStyle(), { color: 'var(--dsw-alias-state-error-primary)' }),
              },
              hotkeyConflict,
            )
          : null,
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': t(row.label),
          'aria-pressed': recording,
          disabled: disabled,
          onClick: function () {
            toggleHotkeyRecording(row.key);
          },
          onBlur: function () {
            if (recording) cancelHotkeyRecording();
          },
          style: settingsHotkeyKeycapStyle(recording, disabled),
        },
        recording ? t('settings.hotkeyRecording') : settingsHotkeyLabel(current),
      ),
    );
  }

  function hotkeyFixedRow(labelKey, keycap, last) {
    return h(
      'div',
      { style: settingsRowStyle(last) },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('span', { style: { fontWeight: 500 } }, t(labelKey)),
        h('span', { style: settingsHintStyle() }, t('settings.hotkeyFixedHint')),
      ),
      h('span', { style: settingsHotkeyFixedStyle() }, keycap),
    );
  }

  function shortcutsCard() {
    var disabled = config === null || config.writable !== true || status === 'saving';
    return h(
      'div',
      { style: settingsCardStyle() },
      SETTINGS_HOTKEY_ROWS.map(function (row) {
        return hotkeyRow(row, false);
      }),
      hotkeyFixedRow('shortcut.exitMode', 'Esc', false),
      hotkeyFixedRow('shortcut.holdSpace', 'Space', true),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '10px 0 12px' } },
        h(
          'button',
          {
            type: 'button',
            disabled: disabled,
            onClick: restoreHotkeyDefaults,
            style: settingsButtonStyle(false, disabled),
          },
          t('settings.hotkeyReset'),
        ),
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
    if (updateView === null) {
      updateText = t('settings.updateUnchecked');
    } else if (updateView.status === 'checking') {
      updateText = t('settings.checking');
    } else if (updateView.status === 'updating') {
      updateText = t('settings.updating');
    } else if (updateView.status === 'unchecked') {
      updateText = t('settings.updateUnchecked');
    } else if (updateView.status === 'current') {
      updateText = t('settings.updateCurrent');
    } else if (updateView.status === 'available') {
      updateText = t('settings.updateAvailable', { version: String(updateView.latest || '') });
    } else if (updateView.status === 'updated' || updateView.status === 'restart-required') {
      updateText = t('settings.updateDone', { version: String(updateView.installed || updateView.latest || '') });
      if (updateView.status === 'restart-required' || updateView.restart === true) {
        updateText += ' · ' + t('settings.updateRestart');
      }
      updateTone = 'success';
    } else if (updateView.status === 'unavailable') {
      updateText = t('settings.updateUnavailable');
    } else if (updateView.status === 'error') {
      updateText = t('settings.updateFailed', { message: String(updateView.message || '') });
      updateTone = 'error';
    }
    var canUpdate = updateView !== null && updateView.status === 'available' && !checking && !updating;
    var showUpdateButton = updateView !== null && (updateView.status === 'available' || updateView.status === 'updating');
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
        showUpdateButton
          ? h(
              'button',
              {
                type: 'button',
                disabled: !canUpdate,
                onClick: runUpdate,
                style: settingsButtonStyle(true, !canUpdate),
              },
              updating || updateView.status === 'updating' ? t('settings.updating') : t('settings.updateNow'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            disabled: checking || updating,
            onClick: checkUpdates,
            style: settingsButtonStyle(false, checking || updating),
          },
          checking ? t('settings.checking') : t('settings.checkUpdate'),
        ),
        h(
          'span',
          {
            'data-dsh-nudge-update-status': updateView !== null && updateView.status ? String(updateView.status) : 'none',
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
      updateView !== null && updateView.status === 'updating'
        ? h('div', { style: Object.assign(settingsHintStyle(), { paddingTop: 4 }) }, t('settings.updateProgress'))
        : null,
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
      h('div', { style: settingsSectionTitleStyle() }, t('settings.sectionShortcuts')),
      shortcutsCard(),
      h('div', { style: Object.assign(settingsHintStyle(), { paddingTop: 8 }) }, t('settings.hotkeyHint')),
      h('div', { style: Object.assign(settingsHintStyle(), { paddingTop: 2 }) }, t('settings.hotkeyScopeHint')),
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
