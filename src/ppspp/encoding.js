const {Buffer} = require('buffer');
const {binBounds} = require('./address');
const {MerkleHashTreeFunctionByteLengths} = require('./integrity');

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
      this.type = ChunkAddressingMethod.Bin32;
      this.value = value;
    }

    read(buffer, offset) {
      this.value = buffer.readUInt32BE(offset);
      return 4;
    }

    byteLength() {
      return 4;
    }

    write(buffer, offset) {
      buffer.writeUInt32BE(this.value, offset);
    }

    rangeByteLength() {
      const [start, end] = binBounds(this.value);
      return (end - start + 1) * chunkSize;
    }

    static from({bin}) {
      return new Bin32ChunkAddress(bin);
    }
  }

  class ChunkRange32ChunkAddress {
    constructor(start = 0, end = 0) {
      this.type = ChunkAddressingMethod.ChunkRange32;
      this.start = start;
      this.end = end;
    }

    read(buffer, offset) {
      this.start = buffer.readUInt32BE(offset);
      this.end = buffer.readUInt32BE(offset + 4);
      return 8;
    }

    byteLength() {
      return 8;
    }

    write(buffer, offset) {
      buffer.writeUInt32BE(this.start, offset);
      buffer.writeUInt32BE(this.end, offset + 4);
    }

    rangeByteLength() {
      return (this.end - this.start + 1) * chunkSize;
    }

    static from({start, end}) {
      return new ChunkRange32ChunkAddress(start, end);
    }
  }

  switch (addressingMethod) {
    case ChunkAddressingMethod.Bin32:
      return Bin32ChunkAddress;
    case ChunkAddressingMethod.ChunkRange32:
      return ChunkRange32ChunkAddress;
    default:
      throw new Error('unsupported chunk addressing method');
  }
};

const createBufferFieldType = byteLength => {
  class BufferField {
    constructor(value = Buffer.alloc(byteLength)) {
      this.value = Buffer.from(value);
    }

    read(buffer, offset) {
      buffer.copy(this.value, 0, offset, offset + byteLength);
      return byteLength;
    }

    byteLength() {
      return byteLength;
    }

    write(buffer, offset) {
      this.value.copy(buffer, offset);
    }
  }

  return BufferField;
};

const createLiveSignatureFieldType = (liveSignatureAlgorithm, swarmId) => {
  const byteLength = swarmId.getLiveSignatureByteLength();

  class LiveSignatureField extends createBufferFieldType(byteLength) {
    constructor(value) {
      super(value);
      this.type = liveSignatureAlgorithm;
    }
  }

  return LiveSignatureField;
};

const createIntegrityHashFieldType = merkleHashTreeFunction => {
  const byteLength = MerkleHashTreeFunctionByteLengths[merkleHashTreeFunction];

  class IntegrityHashField extends createBufferFieldType(byteLength) {
    constructor(value) {
      super(value);
      this.type = merkleHashTreeFunction;
    }
  }

  return IntegrityHashField;
};

const createEncoding = (ChunkAddress, IntegrityHash, LiveSignature) => {
  class Uint8ProtocolOption {
    constructor(value = 0) {
      this.value = value;
    }

    read(buffer, offset) {
      this.value = buffer.readUInt8(offset);
      return 1;
    }

    byteLength() {
      return 1;
    }

    write(buffer, offset) {
      buffer.writeUInt8(this.value, offset);
    }
  }

  class Uint32ProtocolOption {
    constructor(value = 0) {
      this.value = value;
    }

    read(buffer, offset) {
      this.value = buffer.readUInt32BE(offset);
      return 4;
    }

    byteLength() {
      return 4;
    }

    write(buffer, offset) {
      buffer.writeUInt32BE(this.value, offset);
    }
  }

  class VersionProtocolOption extends Uint8ProtocolOption {
    constructor(version = Version.RFC7574) {
      super(version);
      this.type = ProtocolOptions.Version;
    }
  }

  class MinimumVersionProtocolOption extends Uint8ProtocolOption {
    constructor(version = Version.RFC7574) {
      super(version);
      this.type = ProtocolOptions.MinimumVersion;
    }
  }

  class SwarmIdentifierProtocolOption {
    constructor(value = []) {
      this.type = ProtocolOptions.SwarmIdentifier;
      this.value = Buffer.from(value);
    }

    read(buffer, offset) {
      const length = buffer.readUInt16BE(offset);
      offset += 2;

      this.value = buffer.slice(offset, offset + length);

      return length + 2;
    }

    byteLength() {
      return this.value.length + 2;
    }

    write(buffer, offset) {
      buffer.writeUInt16BE(this.value.length, offset);
      this.value.copy(buffer, offset + 2);
    }
  }

  class ContentIntegrityProtectionMethodProtocolOption extends Uint8ProtocolOption {
    constructor(method = ContentIntegrityProtectionMethod.MerkleHashTree) {
      super(method);
      this.type = ProtocolOptions.ContentIntegrityProtectionMethod;
    }
  }

  class MerkleHashTreeFunctionProtocolOption extends Uint8ProtocolOption {
    constructor(algorithm = MerkleHashTreeFunction.SHA256) {
      super(algorithm);
      this.type = ProtocolOptions.MerkleHashTreeFunction;
    }
  }

  class LiveSignatureAlgorithmProtocolOption extends Uint8ProtocolOption {
    constructor(algorithm = LiveSignatureAlgorithm.ECDSAP256SHA256) {
      super(algorithm);
      this.type = ProtocolOptions.LiveSignatureAlgorithm;
    }
  }

  class ChunkAddressingMethodProtocolOption extends Uint8ProtocolOption {
    constructor(method = ChunkAddressingMethod.ChunkRange32) {
      super(method);
      this.type = ProtocolOptions.ChunkAddressingMethod;
    }
  }

  class LiveDiscardWindowProtocolOption extends Uint32ProtocolOption {
    constructor(value = 0) {
      super(value);
      this.type = ProtocolOptions.LiveDiscardWindow;
    }
  }

  class SupportedMessagesProtocolOption {
    constructor(messageTypes = Object.values(MessageTypes).filter(v => !isNaN(v))) {
      this.type = ProtocolOptions.SupportedMessages;
      this.value = {};
      messageTypes.forEach(type => this.value[type] = true);
    }

    read(buffer, offset) {
      const length = buffer.readUInt8(offset);
      offset += 1;

      for (let i = 0; i < length; i ++) {
        const byte = buffer[offset + i];
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
      const buffer = Buffer.alloc(length);

      for (let i = 0; i < length; i ++) {
        let byte = 0;
        for (let j = 0; j < 8; j ++) {
          byte = (byte << 1) | (this.value[i * 8 + j] ? 1 : 0);
        }
        buffer.writeUInt8(byte, i);
      }
      return buffer;
    }

    byteLength() {
      return this.bitmapByteLength() + 1;
    }

    write(buffer, offset) {
      const bitmap = this.toBitmap();
      buffer.writeUInt8(bitmap.length, offset);
      bitmap.copy(buffer, offset + 1);
    }
  }

  class ChunkSizeProtocolOption extends Uint32ProtocolOption {
    constructor(value = 0) {
      super(value);
      this.type = ProtocolOptions.ChunkSize;
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

    read(buffer, offset) {
      let length = 0;

      this.channelId = buffer.readUInt32BE(offset);
      length += 4;

      while (offset + length < buffer.length) {
        const code = buffer.readUInt8(offset + length);
        length += 1;

        if (code === ProtocolOptions.EndOption) {
          break;
        }

        const RecordType = protocolOptionRecordTypes[code];
        const option = new RecordType();

        length += option.read(buffer, offset + length);
        this.options.push(option);
      }

      return length;
    }

    byteLength() {
      return this.options.reduce((length, option) => length + option.byteLength() + 1, 0) + 5;
    }

    write(buffer, offset) {
      let length = 0;

      buffer.writeUInt32BE(this.channelId, offset);
      length += 4;

      this.options.forEach(option => {
        buffer.writeUInt8(option.type, offset + length);
        length += 1;

        option.write(buffer, offset + length);
        length += option.byteLength();
      });

      buffer.writeUInt8(ProtocolOptions.EndOption, offset + length);
      length += 1;

      return length;
    }
  }

  class Timestamp {
    constructor(value = Date.now()) {
      this.value = value;
    }

    read(buffer, offset) {
      const seconds = buffer.readInt32BE(offset);
      const nanoseconds = buffer.readInt32BE(offset + 4);
      this.value = seconds * 1e3 + nanoseconds / 1e6;
      return 8;
    }

    byteLength() {
      return 8;
    }

    write(buffer, offset) {
      buffer.writeInt32BE(Math.floor(this.value / 1e3), offset);
      buffer.writeInt32BE((this.value % 1e3) * 1e6, offset + 4);
    }
  }

  class DataMessage {
    constructor(address = new ChunkAddress(), data = [], timestamp = new Timestamp()) {
      this.type = MessageTypes.DATA;
      this.address = address;
      this.data = Buffer.from(data);
      this.timestamp = timestamp;
    }

    read(buffer, offset) {
      let length = this.address.read(buffer, offset);
      length += this.timestamp.read(buffer, offset + length);

      offset += length;
      const dataLength = Math.min(this.address.rangeByteLength(), buffer.length - offset);
      this.data = buffer.slice(offset, offset + dataLength);

      return length + dataLength;
    }

    byteLength() {
      return this.address.byteLength() + this.data.length + 8;
    }

    write(buffer, offset) {
      let length = 0;

      this.address.write(buffer, offset);
      length += this.address.byteLength();

      this.timestamp.write(buffer, offset + length);
      length += this.timestamp.byteLength();

      this.data.copy(buffer, offset + length);
    }
  }

  class AddressMessage {
    constructor(address = new ChunkAddress()) {
      this.address = address;
    }

    read(buffer, offset) {
      return this.address.read(buffer, offset);
    }

    byteLength() {
      return this.address.byteLength();
    }

    write(buffer, offset) {
      this.address.write(buffer, offset);
    }
  }

  class AckMessage {
    constructor(address = new ChunkAddress(), delaySample = new Timestamp()) {
      this.type = MessageTypes.ACK;
      this.address = address;
      this.delaySample = delaySample;
    }

    read(buffer, offset) {
      let length = this.address.read(buffer, offset);
      length += this.delaySample.read(buffer, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.delaySample.byteLength();
    }

    write(buffer, offset) {
      this.address.write(buffer, offset);
      this.delaySample.write(buffer, offset + this.address.byteLength());
    }
  }

  class HaveMessage extends AddressMessage {
    constructor(address) {
      super(address);
      this.type = MessageTypes.HAVE;
    }
  }

  class IntegrityMessage {
    constructor(address = new ChunkAddress(), hash = new IntegrityHash()) {
      this.type = MessageTypes.INTEGRITY;
      this.address = address;
      this.hash = hash;
    }

    read(buffer, offset) {
      let length = this.address.read(buffer, offset);
      length += this.hash.read(buffer, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.hash.byteLength();
    }

    write(buffer, offset) {
      this.address.write(buffer, offset);
      this.hash.write(buffer, offset + this.address.byteLength());
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

    read(buffer, offset) {
      let length = this.address.read(buffer, offset);
      length += this.timestamp.read(buffer, offset + length);
      length += this.signature.read(buffer, offset + length);
      return length;
    }

    byteLength() {
      return this.address.byteLength() + this.timestamp.byteLength() + this.signature.byteLength();
    }

    write(buffer, offset) {
      let length = 0;

      this.address.write(buffer, offset);
      length += this.address.byteLength();

      this.timestamp.write(buffer, offset + length);
      length += this.timestamp.byteLength();

      this.signature.write(buffer, offset + length);
    }
  }

  class RequestMessage extends AddressMessage {
    constructor(address) {
      super(address);
      this.type = MessageTypes.REQUEST;
    }
  }

  class CancelMessage extends AddressMessage {
    constructor(address) {
      super(address);
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

  class Messages {
    constructor(values = []) {
      this.values = values;
      this.buffer = null;
      this.offset = 0;
    }

    static from(values) {
      if (values instanceof Messages) {
        return values;
      }
      if (Array.isArray(values)) {
        return new Messages(values);
      }
      throw new Error('unable to create Messages from unsupported type');
    }

    next() {
      if (this.offset >= this.buffer.length) {
        return;
      }

      const messageType = this.buffer.readUInt8(this.offset);
      this.offset += 1;

      const RecordType = messageRecordTypes[messageType];
      const message = new RecordType();
      this.values.push(message);

      this.offset += message.read(this.buffer, this.offset);

      return message;
    }

    toArray() {
      // eslint-disable-next-line no-empty
      while (this.next()) {}
      return this.values;
    }

    read(buffer, offset) {
      this.buffer = buffer;
      this.offset = offset;
      return 0;
    }

    byteLength() {
      return this.values.reduce((length, message) => length + message.byteLength() + 1, 0);
    }

    write(buffer, offset) {
      let length = 0;

      this.values.forEach(message => {
        buffer.writeUInt8(message.type, offset + length);
        length += 1;

        message.write(buffer, offset + length);
        length += message.byteLength();
      });

      return length;
    }
  }

  class Datagram {
    constructor(channelId = 0, messages = []) {
      this.channelId = channelId;
      this.messages = Messages.from(messages);
    }

    read(buffer) {
      buffer = Buffer.from(buffer);

      let length = 0;

      this.channelId = buffer.readUInt32BE(0);
      length += 4;

      length += this.messages.read(buffer, length);

      return length;
    }

    byteLength() {
      return this.messages.byteLength() + 4;
    }

    write(buffer) {
      let length = 0;

      buffer.writeUInt32BE(this.channelId, 0);
      length += 4;

      length += this.messages.write(buffer, length);

      return length;
    }

    toBuffer() {
      const buffer = Buffer.alloc(this.byteLength());
      this.write(buffer);
      return buffer;
    }

    static from(buffer) {
      const datagram = new Datagram();
      datagram.read(buffer);
      return datagram;
    }
  }

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
    LiveSignature,
    IntegrityHash,
    ChunkAddress,
  };
};

module.exports = {
  createChunkAddressFieldType,
  createLiveSignatureFieldType,
  createIntegrityHashFieldType,
  createEncoding,
};
