const { Buffer } = require('buffer');
const hirestime = require('../hirestime');
const bins = require('./bins');

const {
  ProtocolOptions,
  Version,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
  ChunkAddressingMethod,
  MessageTypes,
} = require('./constants');

const createChunkAddressFieldType = (addressingMethod, chunkSize) => {
  class Bin32ChunkAddress {
    constructor(value = 0) {
      this.type = ChunkAddressingMethod.Bin32
      this.value = value;
    }

    read(buf, offset) {
      this.value = buf.readUint32BE(offset);
      return 4;
    }

    byteLength() {
      return 4;
    }

    write(buf, offset) {
      buf.writeUint32BE(this.value, offset);
    }

    rangeByteLength() {
      const [start, end] = bins.bounds(this.value);
      return (end - start) * chunkSize;
    }
  }

  class ChunkRange32ChunkAddress {
    constructor(start = 0, end = 0) {
      this.type = ChunkAddressingMethod.ChunkRange32
      this.start = start;
      this.end = end;
    }

    read(buf, offset) {
      this.start = buf.readUint32BE(offset);
      this.end = buf.readUint32BE(offset + 4);
      return 8;
    }

    byteLength() {
      return 8;
    }

    write(buf, offset) {
      buf.writeUint32BE(this.start, offset);
      buf.writeUint32BE(this.end, offset + 4);
    }

    rangeByteLength() {
      return (this.end - this.start) * chunkSize;
    }
  }

  switch (addressingMethod) {
    case ChunkAddressingMethod.Bin32:
      return Bin32ChunkAddress
    case ChunkAddressingMethod.ChunkRange32:
      return ChunkRange32ChunkAddress
    default:
      throw new Error('unsupported chunk addressing method');
  }
};

const createBufferFieldType = byteLength => {
  class BufferField {
    constructor(value) {
      this.value = value;
    }

    read(buf, offset) {
      this.value = buf.slice(offset, offset + byteLength);
      return byteLength;
    }

    byteLength() {
      return byteLength;
    }

    write(buf, offset) {
      this.value.copy(buf, offset);
    }
  }

  return BufferField;
};

const getLiveSignatureByteLength = (liveSignatureAlgorithm, publicKey) => {
  const publicKeyAlgorithm = publicKey.readUInt8(0);

  if (publicKeyAlgorithm !== liveSignatureAlgorithm) {
    throw new Error('live signature algorithm does not match public key');
  }

  switch (liveSignatureAlgorithm) {
    case LiveSignatureAlgorithm.RSASHA1:
    case LiveSignatureAlgorithm.RSASHA256:
      return publicKey.readUint8(1) || publicKey.readUint32BE(2);
    case LiveSignatureAlgorithm.ECDSAP256SHA256:
      return 64;
    case LiveSignatureAlgorithm.ECDSAP384SHA384:
      return 96;
  }
};

const createLiveSignatureFieldType = (liveSignatureAlgorithm, publicKey) => {
  const byteLength = getLiveSignatureByteLength(liveSignatureAlgorithm, publicKey);
  return createBufferFieldType(byteLength);
};

const createIntegrityHashFieldType = merkleHashTreeFunction => {
  const hashByteLengths = {
    [MerkleHashTreeFunction.SHA1]: 20,
    [MerkleHashTreeFunction.SHA224]: 28,
    [MerkleHashTreeFunction.SHA256]: 32,
    [MerkleHashTreeFunction.SHA384]: 48,
    [MerkleHashTreeFunction.SHA512]: 64,
  };
  return createBufferFieldType(hashByteLengths[merkleHashTreeFunction]);
};

const createEncoding = () => {
  class Uint8ProtocolOption {
    constructor(value = 0) {
      this.value = value;
    }

    read(buf, offset) {
      this.value = buf.readUint8(offset);
      return 1;
    }

    byteLength() {
      return 1;
    }

    write(buf, offset) {
      buf.writeUint8(this.value, offset);
    }
  }

  class Uint32ProtocolOption {
    constructor(value = 0) {
      this.value = value;
    }

    read(buf, offset) {
      this.value = buf.readUint32BE(offset);
      return 4;
    }

    byteLength() {
      return 4;
    }

    write(buf, offset) {
      buf.writeUint32BE(this.value, offset);
    }
  }

  class VersionProtocolOption extends Uint8ProtocolOption {
    constructor(version = Version.RFC7574) {
      super(version);
      this.type = ProtocolOptions.Version
    }
  }

  class MinimumVersionProtocolOption extends Uint8ProtocolOption {
    constructor(version = Version.RFC7574) {
      super(version);
      this.type = ProtocolOptions.MinimumVersion
    }
  }

  class SwarmIdentifierProtocolOption {
    constructor(value = '') {
      this.type = ProtocolOptions.SwarmIdentifier
      this.value = value;
    }

    read(buf, offset) {
      const length = buf.readUint16BE(buf, offset);
      offset += 2;

      this.value = buf.slice(offset, offset + length).toString();
      return length + 2;
    }

    byteLength() {
      return Buffer.byteLength(this.value) + 2;
    }

    write(buf, offset) {
      buf.writeUint16BE(Buffer.byteLength(this.value));
      buf.write(this.value, offset + 2);
    }
  }

  class ContentIntegrityProtectionMethodProtocolOption extends Uint8ProtocolOption {
    constructor(method = ContentIntegrityProtectionMethod.MerkleHashTree) {
      super(method);
      this.type = ProtocolOptions.ContentIntegrityProtectionMethod
    }
  }

  class MerkleHashTreeFunctionProtocolOption extends Uint8ProtocolOption {
    constructor(algorithm = MerkleHashTreeFunction.SHA256) {
      super(algorithm);
      this.type = ProtocolOptions.MerkleHashTreeFunction
    }
  }

  class LiveSignatureAlgorithmProtocolOption extends Uint8ProtocolOption {
    constructor(algorithm = LiveSignatureAlgorithm.ECDSAP256SHA256) {
      super(algorithm);
      this.type = ProtocolOptions.LiveSignatureAlgorithm
    }
  }

  class ChunkAddressingMethodProtocolOption extends Uint8ProtocolOption {
    constructor(method = ChunkAddressingMethod.ChunkRange32) {
      super(method);
      this.type = ProtocolOptions.ChunkAddressingMethod
    }
  }

  class LiveDiscardWindowProtocolOption extends Uint32ProtocolOption {
    constructor(value = 0) {
      super(value);
      this.type = ProtocolOptions.LiveDiscardWindow
    }
  }

  class SupportedMessagesProtocolOption {
    constructor(messageTypes = Object.values(MessageTypes)) {
      this.type = ProtocolOptions.SupportedMessages
      this.value = {};
      messageTypes.forEach(type => this.value[type] = true);
    }

    read(buf, offset) {
      const length = buf.readUint8(offset);
      offset += 1;

      for (let i = 0; i < length; i ++) {
        const byte = buf[offset + i];
        for (let j = 0; j < 8; j ++) {
          this.value[i * 8 + j] = Boolean(byte & (1 << 7 - j));
        }
      }

      return length + 1;
    }

    bitmapByteLength() {
      return Math.ceil(Math.max(...Object.keys(this.value)) / 8) + 1;
    }

    toBitmap() {
      const length = this.bitmapByteLength();
      const buf = Buffer.alloc(length);

      for (let i = 0; i < length; i ++) {
        let byte = 0;
        for (let j = 0; j < 8; j ++) {
          byte = (byte << 1) | (this.value[i * 8 + j] ? 1 : 0);
        }
        buf.writeUint8(byte, i);
      }
      return buf;
    }

    byteLength() {
      return this.bitmapByteLength() + 1;
    }

    write(buf, offset) {
      const bitmap = this.toBitmap();
      buf.writeUint8(bitmap.length, offset);
      bitmap.copy(buf, offset + 1);
    }
  }

  class ChunkSizeProtocolOption extends Uint32ProtocolOption {
    constructor(value = 0) {
      super(value);
      this.type = ProtocolOptions.ChunkSize
    }
  }

  const protocolOptionRecordTypes = {
    [ProtocolOptions.Version]: VersionProtocolOption,
    [ProtocolOptions.MinimumVersion]: MinimumVersionProtocolOption,
    [ProtocolOptions.SwarmIdentifier]: SwarmIdentifierProtocolOption,
    [ProtocolOptions.ContentIntegrityProtectionMethod]: ContentIntegrityProtectionMethodProtocolOption,
    [ProtocolOptions.MerkleHashTreeFunction]: MerkleHashTreeFunctionProtocolOption,
    [ProtocolOptions.LiveSignatureAlgorithm]: LiveSignatureAlgorithmProtocolOption,
    [ProtocolOptions.ChunkAddressingMethod]: ChunkAddressingMethodProtocolOption,
    [ProtocolOptions.LiveDiscardWindow]: LiveDiscardWindowProtocolOption,
    [ProtocolOptions.SupportedMessages]: SupportedMessagesProtocolOption,
    [ProtocolOptions.ChunkSize]: ChunkSizeProtocolOption,
  };

  class HandshakeMessage {
    constructor(channelId = 0, options = []) {
      this.type = MessageTypes.HANDSHAKE;
      this.channelId = channelId;
      this.options = options;
    }

    read(buf, offset) {
      let length = 0;

      this.channelId = buf.readUint32BE(offset);
      length += 4;

      while (true) {
        const code = buf.readUint8(offset + length);
        length += 1;

        if (code === ProtocolOptions.EndOption) {
          break;
        }

        const RecordType = protocolOptionRecordTypes[code];
        const option = new RecordType();

        length += option.read(buf, offset + length);
        this.options.push(option);
      }

      return length;
    }

    byteLength() {
      return this.options.reduce((length, option) => length + option.byteLength() + 1, 0) + 5;
    }

    write(buf, offset) {
      let length = 0;

      buf.writeUint32BE(this.channelId, offset);
      length += 4;

      this.options.forEach(option => {
        buf.writeUint8(option.type, offset + length);
        length += 1;

        option.write(buf, offset + length);
        length += option.byteLength();
      });

      buf.writeUint8(ProtocolOptions.EndOption, offset + length)
      length += 1;

      return length;
    }
  }

  class Timestamp {
    constructor(value = hirestime()) {
      this.value = value;
    }

    read(buf, offset) {
      this.value = [
        buf.readUint32BE(buf, offset),
        buf.readUint32BE(buf, offset + 4),
      ];
      return 8;
    }

    byteLength() {
      return 8;
    }

    write(buf, offset) {
      buf.writeUint32BE(this.timestamp[1], offset);
      buf.writeUint32BE(this.timestamp[0], offset + 4);
    }
  }

  class DataMessage {
    constructor(address = new ChunkAddress(), data = [], timestamp = new Timestamp()) {
      this.type = MessageTypes.DATA;
      this.address = address;
      this.data = Buffer.from(data);
      this.timestamp = timestamp;
    }

    read(buf, offset) {
      let length = this.address.read(buf, offset);
      length += this.timestamp.read(buf, offset + length);

      const dataLength = this.address.rangeByteLength();
      this.data = buf.slice(offset + length, offset + length + dataLength);

      return length + dataLength;
    }

    byteLength() {
      return this.address.byteLength() + this.data.length + 8;
    }

    write(buf, offset) {
      let length = 0

      this.address.write(buf, offset);
      length += this.address.byteLength();

      this.timestamp.write(buf, offset + length);
      length += this.timestamp.byteLength();

      this.data.copy(buf, offset + length);
    }
  }

  class AddressMessage {
    constructor(address = new ChunkAddress()) {
      this.address = address;
    }

    read(buf, offset) {
      return this.address.read(buf, offset);
    }

    byteLength() {
      return this.address.byteLength();
    }

    write(buf, offset) {
      this.address.write(buf, offset);
    }
  }

  class AckMessage {
    constructor(address = new ChunkAddress(), delaySample = new Timestamp()) {
      this.type = MessageTypes.ACK;
      this.address = address;
      this.delaySample = delaySample;
    }

    read(buf, offset) {
      let length = this.address.read(buf, offset);
      length += this.delaySample.read(buf, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.delaySample.byteLength();
    }

    write(buf, offset) {
      this.address.write(buf, offset);
      this.delaySample.write(buf, offset + this.address.byteLength());
    }
  }

  class HaveMessage extends AddressMessage {
    constructor(address = new ChunkAddress()) {
      super();
      this.type = MessageTypes.HAVE;
    }
  }

  class IntegrityMessage {
    constructor(address = new ChunkAddress(), hash = new IntegrityHash()) {
      this.type = MessageTypes.INTEGRITY;
      this.hash = hash;
    }

    read(buf, offset) {
      let length = this.address.read(buf, offset);
      length += this.hash.read(buf, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.hash.byteLength();
    }

    write(buf, offset) {
      this.address.write(buf, offset);
      this.hash.write(buf, offset + this.address.byteLength());
    }
  }

  class SignedIntegrityMessage {
    constructor(
      address = new ChunkAddress(),
      timestamp = new Timestamp(),
      signature = new LiveSignature(),
    ) {
      this.type = MessageTypes.SIGNED_INTEGRITY;
      this.address = address;
      this.timestamp = timestamp;
      this.signature = signature;
    }

    read(buf, offset) {
      let length = this.address.read(buf, offset);
      length += this.timestamp.read(buf, offset + length);
      length += this.signature.read(buf, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.timestamp.byteLength() + this.signature.byteLength();
    }

    write(buf, offset) {
      let length = 0;

      this.address.write(buf, offset);
      length += this.address.byteLength();

      this.timestamp.write(buf, offset + length);
      length += this.timestamp.byteLength();

      this.signature.write(buf, offset + length);
    }
  }

  class RequestMessage extends AddressMessage {
    constructor() {
      super();
      this.type = MessageTypes.REQUEST;
    }
  }

  class CancelMessage extends AddressMessage {
    constructor() {
      super();
      this.type = MessageTypes.CANCEL;
    }
  }

  class EmptyMessage {
    read() {
      return 0;
    }

    byteLength() {
      return 0;
    }

    write() {}
  }

  class ChokeMessage extends EmptyMessage{
    constructor() {
      super();
      this.type = MessageTypes.CHOKE;
    }
  }

  class UnchokeMessage extends EmptyMessage{
    constructor() {
      super();
      this.type = MessageTypes.UNCHOKE;
    }
  }

  const messageRecordTypes = {
    [MessageTypes.HANDSHAKE]: HandshakeMessage,
    [MessageTypes.DATA]: DataMessage,
    [MessageTypes.ACK]: AckMessage,
    [MessageTypes.HAVE]: HaveMessage,
    [MessageTypes.INTEGRITY]: IntegrityMessage,
    [MessageTypes.SIGNED_INTEGRITY]: SignedIntegrityMessage,
    [MessageTypes.REQUEST]: RequestMessage,
    [MessageTypes.CANCEL]: CancelMessage,
    [MessageTypes.CHOKE]: ChokeMessage,
    [MessageTypes.UNCHOKE]: UnchokeMessage,
  };

  class Datagram {
    constructor(channelId = 0, messages = []) {
      this.channelId = channelId;
      this.messages = messages;
    }

    read(buf) {
      let length = 0;

      this.channelId = buf.readUint32BE(0);
      length += 4;

      while (length < buf.length) {
        const messageType = buf.readUint8(length);
        length += 1;

        const RecordType = messageRecordTypes[messageType];
        const message = new RecordType();
        this.messages.push(message);

        length += message.read(buf, length);
      }

      return length;
    }

    byteLength() {
      return this.messages.reduce((length, message) => length + message.byteLength() + 1, 0) + 4;
    }

    write(buf) {
      let length = 0;

      buf.writeUint32BE(this.channelId, 0);
      length += 4;

      this.messages.forEach(message => {
        buf.writeUint8(message.type, length);
        length += 1;

        message.write(buf, length);
        length += message.byteLength();
      });

      buf.writeUint8(ProtocolOptions.EndOption, length)
      length += 1;

      return length;
    }

    toBuffer() {
      const buf = Buffer.alloc(this.byteLength());
      this.write(buf);
      return buf;
    }
  }

  let LiveSignature;
  let IntegrityHash;
  let ChunkAddress;

  return {
    VersionProtocolOption,
    MinimumVersionProtocolOption,
    SwarmIdentifierProtocolOption,
    ContentIntegrityProtectionMethodProtocolOption,
    MerkleHashTreeFunctionProtocolOption,
    LiveSignatureAlgorithmProtocolOption,
    ChunkAddressingMethodProtocolOption,
    LiveDiscardWindowProtocolOption,
    SupportedMessagesProtocolOption,
    ChunkSizeProtocolOption,
    HandshakeMessage,
    Timestamp,
    DataMessage,
    AckMessage,
    HaveMessage,
    IntegrityMessage,
    SignedIntegrityMessage,
    RequestMessage,
    CancelMessage,
    ChokeMessage,
    UnchokeMessage,
    Datagram,

    get LiveSignature() {
      return LiveSignature;
    },

    setLiveSignatureFieldType(liveSignatureFieldType) {
      LiveSignature = liveSignatureFieldType;
    },

    get IntegrityHash() {
      return IntegrityHash;
    },

    setIntegrityHashFieldType(integrityHashFieldType) {
      IntegrityHash = integrityHashFieldType;
    },

    get ChunkAddress() {
      return ChunkAddress;
    },

    setChunkAddressFieldType(chunkAddressFieldType) {
      ChunkAddress = chunkAddressFieldType;
    },
  };
};

module.exports = {
  createChunkAddressFieldType,
  createLiveSignatureFieldType,
  createIntegrityHashFieldType,
  createEncoding,
};
