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
