// @ts-nocheck
/** Bridge from the Client half to the Host `nudge/*` remote namespace. */

/** A per-session bridge to the Host remote namespace over the shared /api RPC. */
function createRemote(ctx) {
  return function remoteCall(endpoint, args, signal) {
    var name = REMOTE_NS + '/' + endpoint;
    return Promise.resolve(ctx.connection.rpc.call('/api', name, { args: args || {} }, signal)).then(function (envelope) {
      if (envelope === undefined || envelope === null || envelope.ok !== true) {
        var text = envelope && envelope.error && envelope.error.message ? envelope.error.message : 'remote call failed';
        throw new Error(String(text).replace(/^nudge:\s*/, ''));
      }
      return envelope.value;
    });
  };
}

// ------------------------------------------------------- Host capabilities

/**
 * The Host half is a long-lived Node module: refreshing the DSH page can run a
 * newer Client bundle than the Host still in memory. Cache what the Host says
 * it supports and let the UI explain a mismatch ("restart DSH") instead of
 * showing a raw reason code.
 *
 * `null` means "not probed yet" and is treated as capable so an unavailable
 * ping never produces a false alarm.
 */
var hostCapabilities = null

function rememberHostCapabilities(list) {
  hostCapabilities = Array.isArray(list) ? list.map(function (item) { return String(item); }) : [];
  return hostCapabilities
}

function hostHasCapability(name) {
  if (!Array.isArray(hostCapabilities)) return true
  return hostCapabilities.indexOf(String(name)) >= 0
}

function hostCapabilitySnapshot() {
  return Array.isArray(hostCapabilities) ? hostCapabilities.slice() : null
}

function probeHostCapabilities(ctx) {
  if (Array.isArray(hostCapabilities)) return Promise.resolve(hostCapabilities)
  var remote = createRemote(ctx)
  return Promise.resolve(remote('ping', {}))
    .then(function (result) {
      // An old Host answers ping with { ok, version } only: record "no
      // capabilities" rather than "unknown", so the Client can act on it.
      return rememberHostCapabilities(result && result.capabilities)
    })
    .catch(function () {
      return null
    })
}
