const { EventEmitter } = require('events');
const { Buffer } = require('buffer');
const hirestime = require('./hirestime');

// const CHUNK_SIZE = 64000;
// const NCHUNKS_PER_SIG = 16;

const ProtocolOptions = {
  Version: 0,
  MinimumVersion: 1,
  SwarmIdentifier: 2,
  ContentIntegrityProtectionMethod: 3,
  MerkleHashTreeFunction: 4,
  LiveSignatureAlgorithm: 5,
  ChunkAddressingMethod: 6,
  LiveDiscardWindow: 7,
  SupportedMessages: 8,
  ChunkSize: 9,
  EndOption: 255,
};

const Version = {
  RFC7574: 1,
};

const ContentIntegrityProtectionMethod = {
  None: 0,
  MerkleHashTree: 1,
  SignAll: 2,
  UnifiedMerkleTree: 3,
};

const MerkleHashTreeFunction = {
  SHA1: 0,
  SHA224: 1,
  SHA256: 2,
  SHA384: 3,
  SHA512: 4,
};

const LiveSignatureAlgorithm = {
  RSASHA1: 5,
  RSASHA256: 8,
  ECDSAP256SHA256: 13,
  ECDSAP384SHA384: 14,
};

const ChunkAddressingMethod = {
  Bin32: 0,
  ByteRange64: 1,
  ChunkRange32: 2,
  Bin64: 3,
  ChunkRange64: 4,
};

const VariableChunkSize = 0xffffffff;

const MessageTypes = {
  HANDSHAKE: 0,
  DATA: 1,
  ACK: 2,
  HAVE: 3,
  INTEGRITY: 4,
  PEX_RESv4: 5,
  PEX_REQ: 6,
  SIGNED_INTEGRITY: 7,
  REQUEST: 8,
  CANCEL: 9,
  CHOKE: 10,
  UNCHOKE: 11,
  PEX_RESv6: 12,
  PEX_REScert: 13,
};

const SupportedMessageTypes = [
  MessageTypes.HANDSHAKE,
  MessageTypes.DATA,
  MessageTypes.HAVE,
  MessageTypes.INTEGRITY,
  MessageTypes.SIGNED_INTEGRITY,
  MessageTypes.REQUEST,
  MessageTypes.CANCEL,
  MessageTypes.CHOKE,
  MessageTypes.UNCHOKE,
];

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
      const byte = buf[offset + 1 + i];
      for (let j = 0; j < 8; j ++) {
        this.value[i * 8 + j] = Boolean(byte & (1 << 7 - j));
      }
    }

    return length + 1;
  }

  bitmapByteLength() {
    return Math.ceil(Math.max(...Object.keys(this.value)) / 8);
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
    buf.writeUint8(bitmap.length, 0);
    bitmap.copy(buf, 1);
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
  constructor(options = []) {
    this.type = MessageTypes.HANDSHAKE;
    this.options = options;
  }

  read(buf, offset) {
    let length = 0;

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
    return this.options.reduce((length, option) => length + option.byteLength() + 1, 0) + 1;
  }

  write(buf, offset) {
    let length = 0;

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
}

class DataMessage {
  constructor(address, data = [], timestamp = hirestime()) {
    this.type = MessageTypes.DATA;
    this.address = address;
    this.data = Buffer.from(data);
    this.timestamp = timestamp;
  }

  read(buf, offset) {
    // let length = this.address.read(buf, offset);



    return 0;
  }

  byteLength() {
    return this.address.byteLength() + this.data.length + 8;
  }

  write(buf, offset) {
    let length = 0

    this.address.write(buf, offset);
    length += this.address.byteLength();

    buf.writeUint32BE(this.timestamp[0], offset + length);
    length += 4;
    buf.writeUint32BE(this.timestamp[1], offset + length);
    length += 4;

    this.data.copy(buf, offset + length);
  }
}

class HaveMessage {
  constructor() {
    this.type = MessageTypes.HAVE;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class IntegrityMessage {
  constructor() {
    this.type = MessageTypes.INTEGRITY;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class SignedIntegrityMessage {
  constructor() {
    this.type = MessageTypes.SIGNED_INTEGRITY;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class RequestMessage {
  constructor() {
    this.type = MessageTypes.REQUEST;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class CancelMessage {
  constructor() {
    this.type = MessageTypes.CANCEL;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class ChokeMessage {
  constructor() {
    this.type = MessageTypes.CHOKE;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

class UnchokeMessage {
  constructor() {
    this.type = MessageTypes.UNCHOKE;
  }

  read(buf, offset) {
    return 0;
  }

  byteLength() {
    return 0;
  }

  write(buf, offset) {

  }
}

const messageRecordTypes = {
  [MessageTypes.HANDSHAKE]: HandshakeMessage,
  [MessageTypes.DATA]: DataMessage,
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
      const messageType = buf.readUint32BE(length);
      length += 4;

      const RecordType = messageRecordTypes[messageType];
      const message = new RecordType();
      this.messages.push(message);

      length += message.read(buf, length);
    }

    return length;
  }

  byteLength() {
    return this.messages.reduce((length, message) => message.byteLength() + 1, 0) + 4;
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

// class Decoder {
//   constructor(handshake) {
//     this.readAddress
//   }

//   readAddressRange() {

//   }

//   readAddress() {

//   }
// }

class Client {
  constructor() {
    this.channels = [];
  }

  addChannel(channel) {
    this.channels.push(channel);
  }
}

class Channel extends EventEmitter {
  constructor(channel) {
    super();

    this.channel = channel;
    this.channel.onopen = this.handleOpen.bind(this);
    this.channel.onmessage = this.handleMessage.bind(this);
    this.channel.onclose = this.handleClose.bind(this);
    this.channel.onerror = err => console.log('channel error:', err);
  }

  handleOpen(event) {
    console.log(event);
  }

  handleMessage(msg) {
    console.log(msg)
  }

  handleClose() {
    console.log('close');
  }
}

module.exports = {
  ProtocolOptions,
  Version,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
  ChunkAddressingMethod,
  VariableChunkSize,
  MessageTypes,
  SupportedMessageTypes,
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
  Bin32ChunkAddress,
  ChunkRange32ChunkAddress,
  DataMessage,
  HaveMessage,
  IntegrityMessage,
  SignedIntegrityMessage,
  RequestMessage,
  CancelMessage,
  ChokeMessage,
  UnchokeMessage,
  Datagram,
  Client,
  Channel,
};

