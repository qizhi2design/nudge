// @ts-nocheck
/**
 * Settings → 轻推（Nudge）page.
 *
 * The Settings shell renders one page per `settings.section` entry; this part
 * registers and draws the plugin's own page so the four documented config
 * fields are editable from the left navigation instead of only from the
 * profile patch file.
 *
 * Values are the Loader row config. Reads and writes go through the
 * `nudge/*` remote, which is backed by the Host `configEditor` service — the
 * same profile-patch seam DSH's own plugin pages use. A write reconciles the
 * row, so the Host half may be re-applied right after a save; the page
 * therefore re-reads the snapshot when a save fails instead of claiming a
 * write that did land.
 *
 * Styling reads the shell's `--dsw-alias-*` tokens, so Light / Dark follow the
 * host theme without a local palette.
 */

var SETTINGS_SECTION_ID = 'nudge-config';
var SETTINGS_SECTION_ORDER = 70;

/** Copy for one editable field. */
function settingsFieldSpecs(t) {
  return [
    {
      key: 'sourceRoot',
      kind: 'text',
      label: t('settings.sourceRoot'),
      hint: t('settings.sourceRootHint'),
    },
    {
      key: 'urlRoot',
      kind: 'text',
      label: t('settings.urlRoot'),
      hint: t('settings.urlRootHint'),
    },
    {
      key: 'maxScanFiles',
      kind: 'number',
      min: 20,
      max: 5000,
      label: t('settings.maxScanFiles'),
      hint: t('settings.maxScanFilesHint'),
    },
    {
      key: 'maxFileBytes',
      kind: 'number',
      min: 16384,
      max: 16000000,
      label: t('settings.maxFileBytes'),
      hint: t('settings.maxFileBytesHint'),
    },
  ];
}

/** Normalise one draft into the wire value the Host expects, or throw. */
function settingsDraftValue(spec, draft) {
  if (spec.kind === 'number') {
    var parsed = Number(String(draft).trim());
    if (!Number.isFinite(parsed)) throw new Error(spec.label);
    var floored = Math.floor(parsed);
    if (floored < spec.min || floored > spec.max) throw new Error(spec.label);
    return floored;
  }
  return typeof draft === 'string' ? draft.trim() : '';
}

function settingsFormStyle() {
  return {
    maxWidth: 760,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    color: 'var(--dsw-alias-label-primary)',
    font: '13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
  };
}

function settingsCardStyle() {
  return {
    border: '.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2))',
    borderRadius: 'var(--dsw-radius-xl, 12px)',
    background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1))',
    display: 'flex',
    flexDirection: 'column',
    padding: '4px 16px',
  };
}

function settingsRowStyle() {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    padding: '12px 0',
    borderBottom: '.5px solid var(--dsw-alias-border-l2)',
  };
}

function settingsInputStyle(invalid) {
  return {
    boxSizing: 'border-box',
    width: 260,
    height: 32,
    border: '.5px solid ' + (invalid ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l4)'),
    borderRadius: 'var(--dsw-radius-md, 8px)',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    outline: 'none',
    padding: '0 10px',
    flex: 'none',
  };
}

function settingsButtonStyle(primary) {
  if (primary) {
    return {
      height: 32,
      border: 'none',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'var(--dsw-alias-state-business-primary, #0069fb)',
      color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
      font: 'inherit',
      fontWeight: 500,
      cursor: 'pointer',
      padding: '0 16px',
    };
  }
  return {
    height: 32,
    border: '.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    cursor: 'pointer',
    padding: '0 14px',
  };
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

  var snapshotState = React.useState(null);
  var snapshot = snapshotState[0];
  var setSnapshot = snapshotState[1];
  var draftState = React.useState({});
  var drafts = draftState[0];
  var setDrafts = draftState[1];
  var statusState = React.useState('loading');
  var status = statusState[0];
  var setStatus = statusState[1];
  var messageState = React.useState('');
  var message = messageState[0];
  var setMessage = messageState[1];
  var aliveRef = React.useRef(true);

  React.useEffect(function () {
    aliveRef.current = true;
    return function () {
      aliveRef.current = false;
    };
  }, []);

  var applySnapshot = React.useCallback(function (next) {
    setSnapshot(next);
    var seeded = {};
    var specs = settingsFieldSpecs(t);
    for (var index = 0; index < specs.length; index += 1) {
      var spec = specs[index];
      seeded[spec.key] = String(next.values[spec.key] === undefined ? '' : next.values[spec.key]);
    }
    setDrafts(seeded);
  }, [t]);

  var load = React.useCallback(function () {
    return call('config').then(
      function (next) {
        if (!aliveRef.current) return;
        applySnapshot(next);
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
  }, [call, applySnapshot, t]);

  React.useEffect(function () {
    load();
  }, [load]);

  var specs = settingsFieldSpecs(t);

  /** Turn the drafts into a patch, or an error message. */
  function buildPatch() {
    var patch = {};
    for (var index = 0; index < specs.length; index += 1) {
      var spec = specs[index];
      var draft = drafts[spec.key];
      if (draft === undefined) continue;
      var value;
      try {
        value = settingsDraftValue(spec, draft);
      } catch (error) {
        return { error: t('settings.invalidValue', { field: spec.label }) };
      }
      var current = snapshot && snapshot.values ? snapshot.values[spec.key] : undefined;
      if (String(current) !== String(value)) patch[spec.key] = value;
    }
    return { patch: patch };
  }

  function save() {
    if (snapshot === null || snapshot.writable !== true || status === 'saving') return;
    var built = buildPatch();
    if (built.error) {
      setStatus('ready');
      setMessage(built.error);
      return;
    }
    var patch = built.patch;
    if (Object.keys(patch).length === 0) {
      setStatus('ready');
      setMessage(t('settings.noChanges'));
      return;
    }
    setStatus('saving');
    setMessage('');
    call('configUpdate', { patch }).then(
      function (result) {
        if (!aliveRef.current) return;
        applySnapshot({
          values: result.values,
          defaults: snapshot.defaults,
          overridden: Object.keys(patch),
          writable: snapshot.writable,
          source: snapshot.source,
        });
        setStatus('ready');
        setMessage(t('settings.saved'));
      },
      function (error) {
        if (!aliveRef.current) return;
        // A write reconciles the Loader row, so the Host half — and possibly
        // this RPC — can be replaced mid-flight. Re-read before reporting.
        setTimeout(function () {
          if (!aliveRef.current) return;
          call('config').then(
            function (next) {
              if (!aliveRef.current) return;
              var landed = true;
              Object.keys(patch).forEach(function (key) {
                if (String(next.values[key]) !== String(patch[key])) landed = false;
              });
              if (landed) {
                applySnapshot(next);
                setStatus('ready');
                setMessage(t('settings.savedReloaded'));
              } else {
                setStatus('error');
                setMessage(
                  t('settings.saveFailed', {
                    message: String(error && error.message ? error.message : error),
                  }),
                );
              }
            },
            function () {
              if (!aliveRef.current) return;
              setStatus('error');
              setMessage(
                t('settings.saveFailed', {
                  message: String(error && error.message ? error.message : error),
                }),
              );
            },
          );
        }, 600);
      },
    );
  }

  function restoreDefaults() {
    if (snapshot === null || snapshot.writable !== true || status === 'saving') return;
    var patch = {};
    for (var index = 0; index < specs.length; index += 1) {
      var spec = specs[index];
      patch[spec.key] = snapshot.defaults[spec.key];
    }
    setStatus('saving');
    setMessage('');
    call('configUpdate', { patch }).then(
      function (result) {
        if (!aliveRef.current) return;
        applySnapshot({
          values: result.values,
          defaults: snapshot.defaults,
          overridden: [],
          writable: snapshot.writable,
          source: snapshot.source,
        });
        setStatus('ready');
        setMessage(t('settings.resetDone'));
      },
      function (error) {
        if (!aliveRef.current) return;
        setStatus('error');
        setMessage(
          t('settings.saveFailed', { message: String(error && error.message ? error.message : error) }),
        );
      },
    );
  }

  function row(spec, index, last) {
    var invalid = false;
    var value = drafts[spec.key];
    if (value !== undefined && String(value).trim() !== '') {
      try {
        settingsDraftValue(spec, value);
      } catch (error) {
        invalid = true;
      }
    }
    var overridden =
      snapshot !== null &&
      Array.isArray(snapshot.overridden) &&
      snapshot.overridden.indexOf(spec.key) !== -1;
    return h(
      'div',
      {
        key: spec.key,
        style: last
          ? Object.assign(settingsRowStyle(), { borderBottom: 'none' })
          : settingsRowStyle(),
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
        h(
          'span',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { fontWeight: 500 } }, spec.label),
          overridden
            ? h(
                'span',
                {
                  style: {
                    fontSize: 10,
                    lineHeight: '16px',
                    padding: '0 6px',
                    borderRadius: 999,
                    background: 'var(--dsw-alias-bg-module-platform)',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                t('settings.overridden'),
              )
            : null,
        ),
        h(
          'span',
          {
            style: {
              color: 'var(--dsw-alias-label-tertiary)',
              fontSize: 12,
              lineHeight: '18px',
            },
          },
          spec.hint,
        ),
      ),
      h('input', {
        type: 'text',
        inputMode: spec.kind === 'number' ? 'numeric' : 'text',
        value: value === undefined ? '' : value,
        disabled: snapshot === null || snapshot.writable !== true,
        onChange: function (event) {
          var next = event && event.target ? event.target.value : '';
          setDrafts(function (previous) {
            var merged = Object.assign({}, previous);
            merged[spec.key] = next;
            return merged;
          });
          setMessage('');
        },
        style: settingsInputStyle(invalid),
        'aria-label': spec.label,
      }),
    );
  }

  if (snapshot === null) {
    return h(
      'div',
      { style: settingsFormStyle() },
      h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, t('settings.title')),
      h(
        'p',
        { style: { margin: 0, color: status === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' } },
        status === 'error' ? message : t('settings.loading'),
      ),
    );
  }

  var readOnly = snapshot.writable !== true;
  return h(
    'div',
    { style: settingsFormStyle() },
    h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, t('settings.title')),
    h(
      'p',
      { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
      readOnly ? t('settings.readOnly') : t('settings.intro'),
    ),
    h(
      'div',
      { style: settingsCardStyle() },
      specs.map(function (spec, index) {
        return row(spec, index, index === specs.length - 1);
      }),
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 24 } },
      h(
        'button',
        {
          type: 'button',
          onClick: save,
          disabled: readOnly || status === 'saving',
          style: Object.assign(settingsButtonStyle(true), {
            opacity: readOnly || status === 'saving' ? 0.55 : 1,
            cursor: readOnly || status === 'saving' ? 'default' : 'pointer',
          }),
        },
        status === 'saving' ? t('settings.saving') : t('settings.save'),
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: restoreDefaults,
          disabled: readOnly || status === 'saving',
          style: Object.assign(settingsButtonStyle(false), {
            opacity: readOnly || status === 'saving' ? 0.55 : 1,
            cursor: readOnly || status === 'saving' ? 'default' : 'pointer',
          }),
        },
        t('settings.reset'),
      ),
      h(
        'span',
        {
          style: {
            color:
              status === 'error'
                ? 'var(--dsw-alias-state-error-primary)'
                : 'var(--dsw-alias-label-tertiary)',
            fontSize: 12,
            lineHeight: '18px',
          },
        },
        message,
      ),
    ),
    h(
      'p',
      { style: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 } },
      t('settings.profileHint'),
    ),
  );
}
