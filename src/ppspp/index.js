const { EventEmitter } = require('events');
const BitArray = require('../bitarray');
// const { Buffer } = require('buffer');
// const hirestime = require('../hirestime');
// const LRU = require('lru-cache');
// const crypto = require('crypto');
// const arrayEqual = require('array-equal');
const Address = require('./address');

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
  // ChunkAddressingMethod,
} = require('./constants');

const {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrityVerifierFactory,
} = require('./integrity');

class ChunkMap {
  constructor(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.values = new BitArray(liveDiscardWindow * 2);
  }

  // TODO: ignore very large discard windows from remote peers...
  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.values.resize(liveDiscardWindow * 2);
  }

  set({start, end}) {
    this.values.setRange(start, end + 1);
  }
}

class ChunkBuffer {
  constructor() {
    this.liveDiscardWindow = 0;
  }

  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
  }
}

class Swarm {
  constructor(encoding = createEncoding()) {
    this.encoding = encoding;
    this.availabilityMap = new ChunkMap();
    this.chunkBuffer = new ChunkBuffer();
    this.contentIntegrity = null;
  }

  setProtocolOptions({
    [ProtocolOptions.ContentIntegrityProtectionMethod]: contentIntegrityProtectionMethod,
    [ProtocolOptions.MerkleHashTreeFunction]: merkleHashTreeFunction,
    [ProtocolOptions.LiveSignatureAlgorithm]: liveSignatureAlgorithm,
    [ProtocolOptions.ChunkAddressingMethod]: chunkAddressingMethod,
    [ProtocolOptions.ChunkSize]: chunkSize,
  }) {
    this.encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, chunkSize));
    this.encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
    this.encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, this.publicKey));

    this.contentIntegrity = createContentIntegrityVerifierFactory(
      contentIntegrityProtectionMethod,
      createMerkleHashTreeFunction(merkleHashTreeFunction),
      createLiveSignatureVerifyFunction(liveSignatureAlgorithm, this.publicKey),
    );
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
    this.availableChunks = new ChunkMap();
    this.integrityVerifier = null;

    this.handlers = {
      [MessageTypes.HANDSHAKE]: this.handleHandshakeMessage.bind(this),
      [MessageTypes.DATA]: this.handleDataMessage.bind(this),
      [MessageTypes.HAVE]: this.handleHaveMessage.bind(this),
      [MessageTypes.ACK]: this.handleAckMessage.bind(this),
      [MessageTypes.INTEGRITY]: this.handleIntegrityMessage.bind(this),
      [MessageTypes.SIGNED_INTEGRITY]: this.handleSignedIntegrityMessage.bind(this),
      [MessageTypes.REQUEST]: this.handleRequestMessage.bind(this),
      [MessageTypes.CANCEL]: this.handleCancelMessage.bind(this),
      [MessageTypes.CHOKE]: this.handleChokeMessage.bind(this),
      [MessageTypes.UNCHOKE]: this.handleUnchokeMessage.bind(this),
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

  getContentIntegrityVerifier() {
    if (this.integrityVerifier === null) {
      this.swarm.contentIntegrity.createVerifier();
    }
    return this.integrityVerifier;
  }

  handleData(data) {
    data.messages.toArray().forEach(message => this.handleMessage(message));
    this.integrityVerifier = null;
  }

  handleMessage(message) {
    const handler = this.handlers[message.type];
    if (handler === undefined) {
      throw new Error('unsupported message type');
    }

    console.log(MessageTypes.name(message.type), this.remoteId, message);
    handler(message);
  }

  handleHandshakeMessage(handshake) {
    const options = handshake.options.reduce((options, {type, value}) => ({...options, [type]: value}), {});
    this.swarm.setProtocolOptions(options);

    const liveDiscardWindow = options[ProtocolOptions.LiveDiscardWindow];
    if (liveDiscardWindow !== undefined) {
      this.availableChunks.setLiveDiscardWindow(liveDiscardWindow);
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

  handleDataMessage({address, data}) {
    this.getContentIntegrityVerifier().verifyChunk(data)
      .then(() => {
        this.swarm.chunkBuffer.insert(data);

        const {encoding} = this.swarm;
        this.channel.send(new encoding.Datagram(
          this.remoteId,
          [new encoding.AckMessage(address)],
        ));
      })
      .catch(() => {
        // TODO: update reputation
      });
  }

  handleHaveMessage({address}) {
    this.availableChunks.set(Address.from(address));
    this.swarm.addAvailableChunk(Address.from(address));
  }

  handleAckMessage({address}) {
    this.availableChunks.set(Address.from(address));
    // perf timing?
    // clear retransmit timer?
  }

  handleIntegrityMessage({address, hash}) {
    this.getContentIntegrityVerifier().setHash(Address.from(address), hash);
  }

  handleSignatureMessage({address, signature}) {
    this.getContentIntegrityVerifier().setHashSignature(Address.from(address), signature);
  }

  // TODO: throttling (request queue/prioritization)
  // TODO: retransmission settings
  // TODO: save sent time for perf
  // TODO: push model?
  handleRequestMessage({address}) {
    const chunk = this.swarm.chunks.get(Address.from(address));
    if (chunk === undefined) {
      return;
    }

    const {encoding} = this.swarm;
    const messages = [];

    // TODO: omit signatures for bins the peer has already acked
    this.swarm.contentIntegrity.getConstituentSignatures(Address.from(address))
      .reverse()
      .forEach(({bin, signature}, i) => {
        const address = encoding.ChunkAddress.from(new Address(bin));

        messages.push(new encoding.IntegrityMessage(
          address,
          new encoding.IntegrityHash(signature.getHash()),
        ));

        if (i === 0) {
          messages.push(new encoding.SignedIntegrityMessage(
            address,
            new encoding.Timestamp(),
            new encoding.LiveSignature(signature.getSignatureHash()),
          ));
        }
      });

    messages.push(new encoding.DataMessage(address, chunk));

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
  }

  handleCancelMessage({address}) {
    // TODO: cancel retransmit...
  }

  handleChokeMessage() {
    this.state = PeerState.CHOKED;
  }

  handleUnchokeMessage() {
    this.state = PeerState.READY;
  }
}

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
      }

      data = new peer.swarm.encoding.Datagram();
      data.read(event.data);
      peer.handleData(data);
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
    this.emit('data', event);
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

