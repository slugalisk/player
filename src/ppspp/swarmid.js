const {LiveSignatureAlgorithm} = require('./constants');

const isRsaAlgorithm = liveSignatureAlgorithm => {
  const rsaAlgorithms = [
    LiveSignatureAlgorithm.RSASHA1,
    LiveSignatureAlgorithm.RSASHA256,
  ];
  return rsaAlgorithms.includes(liveSignatureAlgorithm);
};

class SwarmId {
  constructor(
    liveSignatureAlgorithm,
    publicKey,
    publicExponent,
    modulusLength,
  ) {
    this.liveSignatureAlgorithm = liveSignatureAlgorithm;
    this.publicKey = Buffer.from(publicKey);
    this.publicExponent = publicExponent;
    this.modulusLength = modulusLength;
  }

  getLiveSignatureByteLength() {
    switch (this.liveSignatureAlgorithm) {
      case LiveSignatureAlgorithm.RSASHA1:
      case LiveSignatureAlgorithm.RSASHA256:
        return this.modulusLength / 8;
      case LiveSignatureAlgorithm.ECDSAP256SHA256:
        return 64;
      case LiveSignatureAlgorithm.ECDSAP384SHA384:
        return 96;
      default:
        throw new Error('unsupported live signature algorithm');
    }
  }

  getKeyParams() {
    if (isRsaAlgorithm(this.liveSignatureAlgorithm)) {
      return {
        publicExponent: new Uint8Array(this.publicExponent),
        modulusLength: this.modulusLength,
      };
    }
    return {};
  }

  byteLength() {
    const metadataLength = isRsaAlgorithm(this.liveSignatureAlgorithm) ? 9 : 1;
    return this.publicKey.length + metadataLength;
  }

  toBuffer() {
    const buffer = Buffer.alloc(this.byteLength());
    let length = 0;

    buffer.writeUInt8(this.liveSignatureAlgorithm, length);
    length += 1;

    if (isRsaAlgorithm(this.liveSignatureAlgorithm)) {
      Buffer.from(this.publicExponent).copy(buffer, length + 4 - this.publicExponent.length);
      length += 4;

      buffer.writeUInt32BE(this.modulusLength, length);
      length += 4;
    }

    this.publicKey.copy(buffer, length);

    return buffer;
  }

  read(buffer) {
    let length = 0;

    this.liveSignatureAlgorithm = buffer.readUInt8(0);
    length += 1;

    if (isRsaAlgorithm(this.liveSignatureAlgorithm)) {
      this.publicExponent = buffer.slice(length, length + 4);
      length += 4;

      this.modulusLength = buffer.readUInt32BE(length);
      length += 4;
    }

    this.publicKey = buffer.slice(length);
  }

  static from(values) {
    if (ArrayBuffer.isView(values)) {
      const swarmId = Object.create(SwarmId.prototype);
      swarmId.read(Buffer.from(values));
      return swarmId;
    }

    return new SwarmId(
      values.liveSignatureAlgorithm,
      values.publicKey,
      values.publicExponent,
      values.modulusLength,
    );
  }
}

module.exports = SwarmId;
