// @ts-nocheck
/**
 * Product-level plugin preferences shared by every Client surface.
 *
 * The Host owns the persisted values (profile `cordis.patch.yml` row); this
 * store mirrors them in the Client so the toolbar, inspector body, context-menu
 * contributions and the Settings page react immediately after a save without a
 * plugin reload. Language is applied here too: `pluginTranslate` falls back to
 * the DSH locale service for `auto`, and uses the embedded dictionaries for an
 * explicit `zh` / `en` plugin-only override.
 */

var PLUGIN_CONFIG_DEFAULTS = Object.freeze({
  language: 'auto',
  enableAnnotate: true,
  enableEdit: true,
  enableDomTree: true,
  enableWorkspaceVersions: true,
  enableHotReload: true,
  contextMenuLink: true,
  contextMenuTab: true,
})

var pluginConfigState = { loaded: false, pending: false, values: null, error: null }
var pluginConfigListeners = new Set()

function pluginConfigEmit() {
  pluginConfigListeners.forEach(function (listener) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-nudge] plugin config listener failed', error)
    }
  })
}

function pluginConfigSnapshot() {
  return pluginConfigState
}

function subscribePluginConfig(listener) {
  pluginConfigListeners.add(listener)
  return function () {
    pluginConfigListeners.delete(listener)
  }
}

/** Current values, filled in with defaults for anything the Host omits. */
function pluginConfigValues() {
  var values = pluginConfigState.values;
  var merged = Object.assign({}, PLUGIN_CONFIG_DEFAULTS);
  if (values !== null && typeof values === 'object') {
    Object.keys(PLUGIN_CONFIG_DEFAULTS).forEach(function (key) {
      if (values[key] !== undefined) merged[key] = values[key];
    });
  }
  return merged;
}

function pluginConfigDefaults() {
  return PLUGIN_CONFIG_DEFAULTS;
}

/** Replace the mirrored values (used by the initial load and the settings save). */
function setPluginConfig(values, error) {
  var next = {
    loaded: true,
    pending: false,
    values: values !== null && typeof values === 'object' ? values : {},
    error: error === undefined ? null : error,
  };
  pluginConfigState = next;
  pluginConfigEmit();
}

/**
 * Fetch the Host snapshot once per plugin lifetime. Failures stay silent for the
 * toolbar (defaults keep every feature enabled); the Settings page reports its
 * own load errors.
 */
function loadPluginConfig(ctx) {
  if (pluginConfigState.loaded || pluginConfigState.pending) return Promise.resolve(pluginConfigValues());
  var connection = ctx === null || ctx === undefined ? undefined : ctx.connection;
  if (
    connection === undefined ||
    connection === null ||
    connection.rpc === undefined ||
    connection.rpc === null ||
    typeof connection.rpc.call !== 'function'
  ) {
    setPluginConfig({}, 'connection-unavailable');
    return Promise.resolve(pluginConfigValues());
  }
  pluginConfigState = Object.assign({}, pluginConfigState, { pending: true });
  var remote = createRemote(ctx);
  return remote('config').then(
    function (result) {
      setPluginConfig(result && result.values ? result.values : {}, null);
      return pluginConfigValues();
    },
    function (error) {
      setPluginConfig({}, String(error && error.message ? error.message : error));
      return pluginConfigValues();
    },
  );
}

function usePluginConfig() {
  var snapshot = React.useSyncExternalStore(subscribePluginConfig, pluginConfigSnapshot, pluginConfigSnapshot);
  var values = Object.assign({}, PLUGIN_CONFIG_DEFAULTS);
  if (snapshot.values !== null && typeof snapshot.values === 'object') {
    Object.keys(PLUGIN_CONFIG_DEFAULTS).forEach(function (key) {
      if (snapshot.values[key] !== undefined) values[key] = snapshot.values[key];
    });
  }
  return { loaded: snapshot.loaded, error: snapshot.error, values: values };
}

// ------------------------------------------------------------ translation

/** Replace `{name}` placeholders in one locale string. */
function formatPluginText(text, vars) {
  var value = String(text === null || text === undefined ? '' : text);
  if (vars === null || vars === undefined || typeof vars !== 'object') return value;
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, function (match, key) {
    var replacement = vars[key];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

/**
 * Translate one plugin string.
 *
 * @param baseT - DSH locale-bound translator (used for `auto` and missing keys)
 * @param key - flattened locale key
 * @param vars - optional `{ placeholder }` values
 */
function pluginTranslate(baseT, key, vars) {
  var language = pluginConfigValues().language;
  if (language === 'zh' || language === 'en') {
    var dict = language === 'zh' ? NUDGE_LOCALE_ZH : NUDGE_LOCALE_EN;
    var text = dict === undefined || dict === null ? undefined : dict[key];
    if (text !== undefined && text !== null) return formatPluginText(text, vars);
  }
  if (typeof baseT === 'function') return baseT(key, vars);
  return key;
}

/** Build the plugin translator from the DSH locale binding. */
function createPluginTranslator(baseT) {
  return function nudgeT(key, vars) {
    return pluginTranslate(baseT, key, vars);
  };
}
