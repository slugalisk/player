const { EventEmitter } = require('events');
const BitSet = require('../bitset');
// const { Buffer } = require('buffer');
// const hirestime = require('../hirestime');
// const LRU = require('lru-cache');
// const crypto = require('crypto');
// const arrayEqual = require('array-equal');
// const bins = require('../bins');

// const CHUNK_SIZE = 64000;
// const NCHUNKS_PER_SIG = 16;

const {
  createChunkAddressFieldType,
  createLiveSignatureFieldType,
  createIntegrityHashFieldType,
  createEncoding,
} = require('./encoding');

const {
  MaxChannelId,
  ProtocolOptions,
  MessageTypes,
} = require('./constants');

const {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrity,
} = require('./integrity');

class ChunkAvailabilityMap {
  constructor() {
    this.liveDiscardWindow = Infinity;
    this.offset = 0;
    this.bitset = new BitSet();
  }

  // TODO: limit value to avoid allocating huge buffers...
  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.bitset.resize(liveDiscardWindow);
  }
}

class ChunkBuffer {
  constructor() {
    this.liveDiscardWindow = Infinity;
  }

  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
  }
}

class Swarm {
  constructor(encoding = createEncoding()) {
    this.encoding = encoding;
    this.chunkAvailabilityMap = new ChunkAvailabilityMap();
    this.chunkBuffer = new ChunkBuffer();
  }

  setProtocolOptions({
    [ProtocolOptions.ContentIntegrityProtectionMethod]: contentIntegrityProtectionMethod,
    [ProtocolOptions.MerkleHashTreeFunction]: merkleHashTreeFunction,
    [ProtocolOptions.LiveSignatureAlgorithm]: liveSignatureAlgorithm,
    [ProtocolOptions.ChunkAddressingMethod]: chunkAddressingMethod,
    [ProtocolOptions.ChunkSize]: chunkSize,
  }) {
    console.log(contentIntegrityProtectionMethod);

    this.encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, chunkSize));
    this.encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
    this.encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, this.publicKey));

    this.contentIntegrity = createContentIntegrity(contentIntegrityProtectionMethod, merkleHashTreeFunction, liveSignatureAlgorithm);
  }
}

const PeerState = {
  CONNECTING: 1,
  AWAITING_HANDSHAKE: 2,
  READY: 3,
  CHOKED: 4,
  DISCONNECTING: 5,
};

class Peer {
  constructor(swarm, channel, remoteId = 0, localId = Peer.createChannelId()) {
    this.swarm = swarm;
    this.channel = channel;
    this.remoteId = remoteId;
    this.localId = localId;
    this.state = PeerState.CONNECTING;
    this.ChunkAvailabilityMap = new ChunkAvailabilityMap();

    this.handlers = {
      [MessageTypes.HANDSHAKE]: this.handleHandshake.bind(this),
      [MessageTypes.DATA]: this.handleData.bind(this),
      [MessageTypes.HAVE]: this.handleHave.bind(this),
      [MessageTypes.ACK]: this.handleAck.bind(this),
      [MessageTypes.INTEGRITY]: this.handleIntegrity.bind(this),
      [MessageTypes.SIGNED_INTEGRITY]: this.handleSignedIntegrity.bind(this),
      [MessageTypes.REQUEST]: this.handleRequest.bind(this),
      [MessageTypes.CANCEL]: this.handleCancel.bind(this),
      [MessageTypes.CHOKE]: this.handleChoke.bind(this),
      [MessageTypes.UNCHOKE]: this.handleUnchoke.bind(this),
    };
  }

  static createChannelId() {
    return Math.round(Math.random() * MaxChannelId);
  }

  init() {
    const {encoding} = this.swarm;
    const messages = [];

    messages.push(new encoding.HandshakeMessage(
      this.localId,
      [
        new encoding.VersionProtocolOption(),
        new encoding.MinimumVersionProtocolOption(),
        new encoding.SwarmIdentifierProtocolOption(this.swarm.id),
        new encoding.LiveDiscardWindowProtocolOption(6000),
        new encoding.SupportedMessagesProtocolOption(Object.keys(this.handlers)),
      ],
    ));

    if (this.swarm.hasData()) {
      messages.push(new encoding.ChokeMessage());
    }

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
    this.state = PeerState.AWAITING_HANDSHAKE;
  }

  handleMessage(message) {
    const handler = this.handlers[message.type];
    if (handler === undefined) {
      throw new Error('unsupported message type');
    }

    console.log(MessageTypes.name(message.type), this.remoteId, message);
    handler(message);
  }

  handleHandshake(handshake) {
    const options = handshake.options.reduce((options, {type, value}) => ({...options, [type]: value}), {});
    this.swarm.setProtocolOptions(options);

    const liveDiscardWindow = options[ProtocolOptions.LiveDiscardWindow];
    if (liveDiscardWindow !== undefined) {
      this.ChunkAvailabilityMap.setLiveDiscardWindow(liveDiscardWindow);
    }

    if (this.state === PeerState.AWAITING_HANDSHAKE) {
      // we initialized the connection and were waiting for handshake memes...
      return;
    }

    // we sent a handshake and this is the response
    // - we are already in this swarm
    // - we are joining this swarm for the first time
    // we are receiving a handshake request
    // - we are in this swarm
    // - we are not in this swarm

    //

    this.remoteId = handshake.channelId;

    const {encoding} = this.swarm;
    const data = new encoding.Datagram(
      this.remoteId,
      [
        new encoding.HandshakeMessage(
          this.localId,
          [
            ...this.swarm.protocolOptions,
            new encoding.LiveDiscardWindowProtocolOption(6000),
            new encoding.SupportedMessagesProtocolOption(Object.keys(this.handlers)),
          ]
        ),
      ],
    );
    this.channel.send(data);
    this.state = PeerState.READY;
  }

  handleData(data) {

  }

  handleHave(data) {

  }

  handleAck(data) {

  }

  handleIntegrity(data) {

  }

  handleSignedIntegrity(data) {

  }

  handleRequest(data) {

  }

  handleCancel(data) {

  }

  handleChoke(data) {
    this.state = PeerState.CHOKED;
  }

  handleUnchoke(data) {
    this.state = PeerState.READY;
  }
}

// class Stream extends EventEmitter {
//   constructor(id) {
//     super();
//     this.id = id;
//   }

//   close() {

//   }
// }

class Client {
  constructor() {
    this.channels = [];

    this.genericEncoding = createEncoding();
    this.swarms = {};
  }

  publishSwarm(swarm) {
    this.swarms[swarm.id.toString('base64')] = swarm;
  }

  addChannel(channel) {
    this.channels.push(channel);

    const peers = {};

    channel.once('open', () => {
      Object.values(this.swarms).forEach(swarm => {
        const peer = new Peer(swarm, channel);
        peers[peer.id] = peer;
        peer.init();
      });
    });

    channel.once('close', () => {
      Object.values(peers).forEach(peer => peer.close());
    });

    channel.on('data', (event) => {
      let data = new this.genericEncoding.Datagram();
      data.read(event.data);

      let peer = peers[data.channelId];
      if (peer === undefined) {
        if (data.channelId !== 0) {
          return;
        }

        const handshake = data.messages.next();
        if (handshake === undefined || handshake.type !== MessageTypes.HANDSHAKE) {
          return;
        }
        const swarmId = handshake.options.find(({type}) => type === ProtocolOptions.SwarmIdentifier);
        if (swarmId === undefined) {
          return;
        }
        const swarm = this.swarms[swarmId.value.toString('base64')];
        if (swarm === undefined) {
          return;
        }

        peer = new Peer(swarm, channel);
        peers[peer.id] = peer;
      } else {
        data = new peer.swarm.encoding.Datagram();
        data.read(event.data);
      }

      data.messages.toArray().forEach(message => peer.handleMessage(message));
    });
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

  handleOpen() {
    this.emit('open');
  }

  handleMessage(event) {
    this.emit('message', event);
  }

  handleClose() {
    this.emit('close');
  }

  send(data) {
    this.channel.send(data.toBuffer());
  }
}

module.exports = {
  Swarm,
  Client,
  Channel,
};

