const { EventEmitter } = require('events');
const { Buffer } = require('buffer');
const hirestime = require('./hirestime');
const LRU = require('lru-cache');
const crypto = require('crypto');
const arrayEqual = require('array-equal');
const bins = require('./bins');

// const CHUNK_SIZE = 64000;
// const NCHUNKS_PER_SIG = 16;

const MaxChannelId = 0xffffffff;

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

    buf.writeUint32BE(this.timestamp[1], offset + length);
    length += 4;
    buf.writeUint32BE(this.timestamp[0], offset + length);
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
  constructor(channel=new Channel(), messages = []) {
    this.channel = channel;
    this.channelId = channel.localId;
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
      message.datagram = this;

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

class ChunkSet {
  constructor(size) {
    this.size = size;
    this.values = new Array(size);
    this.hashes = new Array(size * 2 - 1);
  }

  static from(chunks) {
    const set = new ChunkSet(chunks.length);

    for (let i = 0; i < set.size; i ++) {
      set.values[i] = chunks[i];
      set.hashes[i + set.size - 1] = hashValue(chunks[i]);
    }

    for (let i = (set.size - 1) * 2; i > 0; i -= 2) {
      const siblings = [set.hashes[i - 1], set.hashes[i]];
      set.hashes[Math.floor(i / 2) - 1] = hashValue(Buffer.concat(siblings));
    }

    return set;
  }

  insertHash(bin, hash) {
    if (bin >= this.hashes.length) {
      throw new Error('hash bin out of range');
    }

    let left = 0;
    let right = this.hashes.length - 1;
    let index = 0;
    while (true) {
      const mid = Math.floor((left + right) / 2);

      if (mid === bin) {
        break;
      }

      index = (index + 1) * 2;
      if (mid < bin) {
        left = mid + 1;
      } else {
        right = mid;
        index --;
      }
    }

    this.hashes[index] = hash;
  }

  insertChunk(bin, value) {
    const uncles = this.getUncleHashes(bin);
    const hashes = new Array(uncles.lenght);
    let hash = hashValue(value);

    for (let i = 0; i < uncles.length; i ++) {
      const {
        branch,
        hash: uncleHash,
        uncleIndex: index,
      } = uncles[i];

      hashes[i] = {
        index,
        hash,
      };

      const siblings = branch === 1 ? [hash, uncleHash] : [uncleHash, hash];
      hash = hashValue(Buffer.concat(siblings));
    }

    if (!arrayEqual(this.hashes[0], hash)) {
      throw new Error('invalid hash');
    }

    hashes.forEach(({index, hash}) => this.hashes[index] = hash);
    this.values[bin / 2] = value;
  }

  getChunk(bin) {
    return this.values[bin / 2];
  }

  getRootHash() {
    return this.hashes[0];
  }

  getUncleHashes(bin) {
    if (bin >= this.hashes.length) {
      throw new Error('hash bin out of range');
    }

    const hashes = [];
    let index = this.values.length + bin / 2 - 1;
    let stride = 2;
    let parent = bin;

    while (index !== 0) {
      const branch = index % 2 === 1 ? 1 : -1;

      hashes.push({
        branch,
        bin: parent + branch * stride,
        hash: this.hashes[index + branch],
        uncleIndex: index,
      });

      index = Math.floor((index - 1) / 2);
      parent += branch * stride / 2;
      stride *= 2;
    }

    return hashes;
  }

  debug() {
    for (let i = 0; i < this.values.length; i ++) {
      console.log(i, this.values[i]);
    }
    console.log('---');
    for (let i = 0; i < this.hashes.length; i ++) {
      console.log(i, this.hashes[i]);
    }
  }
}

class Swarm {
  constructor(trackers, id, peers = []) {
    this.trackers = trackers;
    this.id = id;
    this.peers = peers;
    this.chunks = [];

    this.protocolOptions = [
      new VersionProtocolOption(),
      new MinimumVersionProtocolOption(),
      new SwarmIdentifierProtocolOption(),
      new ContentIntegrityProtectionMethodProtocolOption(),
      new MerkleHashTreeFunctionProtocolOption(),
      new LiveSignatureAlgorithmProtocolOption(),
      new ChunkAddressingMethodProtocolOption(),
      new LiveDiscardWindowProtocolOption(),
      new SupportedMessagesProtocolOption(),
      new ChunkSizeProtocolOption(),
    ];
  }

  join(dht) {
    dht.send(this.id, 'ppspp.peers.request')
    // bootstrap through dht
  }

  addPeer(peer) {

  }
}

class Peer {
  constructor(swarm, id = Peer.createChannelId()) {
    this.id = id;
    this.remoteId = handshake.channelId.value;
  }

  static createChannelId() {
    return Math.round(Math.random() * MaxChannelId);
  }

  onMessage(message) {

  }
}

class Protocol {
  constructor(handshake = new HandshakeMessage()) {

  }

  handshakeRequired() {
    // ...
  }
}

class HashTree {
  constructor(rootDigeets, startChunk, endChunk) {
    this.startChunk = startChunk;
    this.endChunk = endChunk;

    this.width = (endChunk - startChunk);
    this.height = Math.log2(this.width);

    this.chunks = new Array(this.width);
    this.chunks[this.width / 2] = rootDigeets;
  }

  insert(index, digest) {
    this.chunks[index] = digest
  }

  // TODO: we can probably figure out all the indexes just by storing
  // whether each value was on the right or left side of its parent...
  // and we should be able to figure this out in a single loop traversing
  // up the tree
  verify(index, value) {
    index *= 2

    let uncles = new Array(this.height);
    // let digests = new Array(this.height);
    let sides = new Array(this.height);

    let left = this.startChunk;
    let right = this.endChunk;

    for (let i = this.height - 1; i >= 0; i --) {
      const mid = (left + right) / 2;
      // digests[i] = mid;

      if (index >= mid) {
        sides[i] = 1;
        uncles[i] = Math.floor((left + mid) / 2);
        left = mid;
      } else {
        sides[i] = 0;
        uncles[i] = Math.floor((right + mid) / 2);
        right = mid;
      }
    }

    let digest = this.hash(value);
    for (let i = 0; i < this.height; i ++) {
      if (sides[i] === 1) {
        digest = this.hash(Buffer.concat(this.chunks[uncles[i]], digest));
      } else {
        digest = this.hash(Buffer.concat(digest, this.chunks[uncles[i]]));
      }
    }

    return arrayEqual(digest, this.chunks[this.width / 2]);
  }
}

class Sha256HashTree extends HashTree {
  hash(data) {
    const hash = crypto.createHash('SHA256');
    hash.update(data);
    return hash.digest();
  }
}

class Data {
  constructor(protocolOptions, signedIntegrity) {
    this.protocolOptions = protocolOptions;
    this.signedIntegrity = signedIntegrity;
    this.hashes = [];
    this.data = [];
  }

  addHash(index, data) {
    this.hashes[index] = data;
  }

  addData(index, data) {

  }

  merge(data) {

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

class Stream extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
  }

  close() {

  }
}

class MemeHub extends EventEmitter {
  constructor() {
    super();

    this.swarms = {};
  }

  join(id) {
    this.swarms[id] = new swarm(id);
  }

  part(id) {
    this.swarm[id].close();
    delete this.swarm[id];
  }
}

class Client {
  constructor() {
    this.channels = [];

    this.memeHub = new MemeHub();
    this.pendingPeers = new LRU({
      max: 1024,
      maxAge: 1000 * 60,
    });
  }

  publish(swarm) {

  }

  addChannel(channel) {
    this.channels.push(channel);

    channel.once('open', () => {
      Object.values(this.memeHub.swarms).forEach(swarm => {

        const peer = new Peer(swarm);
        this.pendingPeers.set(peer.id, peer);

        const data = new Datagram(
          0,
          [
            new HandshakeMessage(
              peer.id,
              [
                new VersionProtocolOption(),
                new MinimumVersionProtocolOption(),
                new SwarmIdentifierProtocolOption(swarm.id),
                new LiveDiscardWindowProtocolOption(6000),
                new SupportedMessagesProtocolOption(SupportedMessageTypes),
              ]
            ),
          ],
        );
        channel.channel.send(data.toBuffer());
      });
    });

    channel.on('message', message => {
      switch (message.type) {
        case MessageTypes.HANDSHAKE:
          this.handleHandshake(channel, message);
          break;
        case MessageTypes.DATA:

          break;
        case MessageTypes.HAVE:

          break;
        case MessageTypes.INTEGRITY:

          break;
        case MessageTypes.SIGNED_INTEGRITY:

          break;
        case MessageTypes.REQUEST:

          break;
        case MessageTypes.CANCEL:

          break;
        case MessageTypes.CHOKE:

          break;
        case MessageTypes.UNCHOKE:

          break;
      }
    });
  }

  handleHandshake(channel, handshake) {
    // we sent a handshake and this is the response
    // - we are already in this swarm
    // - we are joining this swarm for the first time
    // we are receiving a handshake request
    // - we are in this swarm
    // - we are not in this swarm


    const swarmId = handshake.values[ProtocolOptions.SwarmIdentifier].value;
    const swarm = this.memeHub.swarms[swarmId];

    if (swarm === undefined) {
      return;
    }

    const isPeerRequest = handshake.datagram.channelId === 0;
    const peer = isPeerRequest
      ? new Peer(swarm)
      : this.pendingPeers.get(handshake.channelId);

    if (peer === undefined) {
      return;
    }

    peer.remoteId = handshake.channelId;

    if (isPeerRequest) {
      const data = new Datagram(
        handshake.channelId,
        [
          new HandshakeMessage(
            peer.id,
            [
              ...swarm.protocolOptions,
              new LiveDiscardWindowProtocolOption(6000),
              new SupportedMessagesProtocolOption(SupportedMessageTypes),
            ]
          ),
        ],
      );
      channel.channel.send(data.toBuffer());
    }

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

    const handshake = new Datagram(
      this.memeHub,
      [new Handshake(this.memeHub)],
    );
    this.channel.send(new Uint8Array(handshake.toBuffer()));
  }

  handleMessage(event) {
    const data = new Datagram(this.memeHub);
    data.read(event.data);
    data.messages.forEach(message => this.emit('message', message));
  }

  handleClose() {
    this.emit('close');
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

