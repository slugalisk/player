import hexToArrayBuffer from 'hex-to-array-buffer';

export default function hexToUint8Array(v) {
  return new Uint8Array(hexToArrayBuffer(v));
}
