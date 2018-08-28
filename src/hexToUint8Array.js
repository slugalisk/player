const hexToArrayBuffer = require('hex-to-array-buffer');

module.exports = function hexToUint8Array(v) {
  return new Uint8Array(hexToArrayBuffer(v));
}
