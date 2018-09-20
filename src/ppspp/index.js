const { EventEmitter } = require('events');
const BitArray = require('../bitarray');
const Address = require('./address');
const SwarmId = require('./swarmid');
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
  createLiveSignatureVerifyFunction,
  createContentIntegrityVerifierFactory,
} = require('./integrity');

const genericEncoding = createEncoding();

class ChunkMap extends EventEmitter {
  constructor(liveDiscardWindow) {
    super();

    this.liveDiscardWindow = liveDiscardWindow;
    this.values = new BitArray(liveDiscardWindow * 2);
  }

  // TODO: ignore very large discard windows from remote peers...
  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.values.resize(liveDiscardWindow * 2);
  }

  set(address) {
    this.values.setRange(address.start, address.end + 1);
    this.emit('set', address);
  }

  get({bin}) {
    return this.values.get(bin);
  }
}

class ChunkBuffer {
  constructor(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.chunks = [];
  }

  setLiveDiscardWindow(liveDiscardWindow) {
    this.liveDiscardWindow = liveDiscardWindow;
    this.chunks = new Array(liveDiscardWindow);
  }

  set({start}, chunks) {
    for (let i = 0; i < chunks.length; i ++) {
      this.chunks[(start / 2 + i) % this.liveDiscardWindow] = chunks[i];
    }
  }

  get({bin}) {
    return this.chunks[(bin / 2) % this.liveDiscardWindow];
  }
}

class Swarm {
  constructor(
    id,
    encoding = createEncoding(),
    contentIntegrity = null,
    availableChunks = new ChunkMap(),
    chunkBuffer = new ChunkBuffer(),
  ) {
    this.id = id;
    this.encoding = encoding;
    this.contentIntegrity = contentIntegrity;
    this.availableChunks = availableChunks;
    this.chunkBuffer = chunkBuffer;

    this.peers = {};

    this.protocolOptions = [
      new encoding.VersionProtocolOption(),
      new encoding.MinimumVersionProtocolOption(),
      new encoding.SwarmIdentifierProtocolOption(this.id.toBuffer()),
    ];
  }

  setProtocolOptions({
    [ProtocolOptions.ContentIntegrityProtectionMethod]: contentIntegrityProtectionMethod,
    [ProtocolOptions.MerkleHashTreeFunction]: merkleHashTreeFunction,
    [ProtocolOptions.LiveSignatureAlgorithm]: liveSignatureAlgorithm,
    [ProtocolOptions.ChunkAddressingMethod]: chunkAddressingMethod,
    [ProtocolOptions.ChunkSize]: chunkSize,
  }) {
    console.log('setProtocolOptions', {
      contentIntegrityProtectionMethod,
      merkleHashTreeFunction,
      liveSignatureAlgorithm,
      chunkAddressingMethod,
      chunkSize,
    });
    console.log('swarmId', this.id);
    this.encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, chunkSize));
    this.encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
    this.encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, this.id));

    this.contentIntegrity = createContentIntegrityVerifierFactory(
      contentIntegrityProtectionMethod,
      createMerkleHashTreeFunction(merkleHashTreeFunction),
      createLiveSignatureVerifyFunction(liveSignatureAlgorithm, this.id),
    );
  }

  addPeer(peer) {
    this.peers[peer.localId] = peer;
  }

  removePeer(peer) {
    delete this.peers[peer.localId];
  }
}

const PeerState = {
  CONNECTING: 1,
  AWAITING_HANDSHAKE: 2,
  READY: 3,
  CHOKED: 4,
  DISCONNECTING: 5,
};

// TODO: disconnect inactive peers
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

    this.handleAvailableDataSet = this.handleAvailableDataSet.bind(this);
    swarm.availableChunks.on('set', this.handleAvailableDataSet);

    this.swarm.addPeer(this);
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
        ...this.swarm.protocolOptions,
        new encoding.SupportedMessagesProtocolOption(Object.keys(this.handlers)),
      ],
    ));

    // if (this.swarm.hasData()) {
    //   messages.push(new encoding.ChokeMessage());
    // }

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
    this.state = PeerState.AWAITING_HANDSHAKE;
  }

  close() {
    this.swarm.removePeer(this);
    this.swarm.availableChunks.removeEventListener('set', this.handleAvailableDataSet);
  }

  handleAvailableDataSet(address) {
    const {encoding} = this.swarm;

    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.HaveMessage(encoding.ChunkAddress.from(address))],
    ));
  }

  getContentIntegrityVerifier(address) {
    if (this.integrityVerifier === null) {
      this.integrityVerifier = this.swarm.contentIntegrity.createVerifier(address);
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

    // console.log(MessageTypes.name(message.type), this.remoteId, message);
    handler(message);
  }

  handleHandshakeMessage(handshake) {
    const options = handshake.options.reduce((options, {type, value}) => ({...options, [type]: value}), {});

    const liveDiscardWindow = options[ProtocolOptions.LiveDiscardWindow];
    if (liveDiscardWindow !== undefined) {
      this.availableChunks.setLiveDiscardWindow(liveDiscardWindow);
    }

    this.remoteId = handshake.channelId;

    const {encoding} = this.swarm;

    if (this.state === PeerState.AWAITING_HANDSHAKE) {
      this.swarm.setProtocolOptions(options);

      // we initialized the connection and were waiting for handshake memes...
      // - we are already in this swarm
      // - we are joining this swarm for the first time

      this.channel.send(new encoding.Datagram(
        this.remoteId,
        [
          new encoding.HandshakeMessage(
            this.localId,
            [new encoding.LiveDiscardWindowProtocolOption(6000)],
          ),
        ],
      ));

      this.state = PeerState.READY;
      return;
    }

    if (this.state === PeerState.CONNECTING) {
      // we are receiving a handshake request

      this.channel.send(new encoding.Datagram(
        this.remoteId,
        [
          new encoding.HandshakeMessage(
            this.localId,
            [
              ...this.swarm.protocolOptions,
              new encoding.SupportedMessagesProtocolOption(Object.keys(this.handlers)),
            ],
          ),
        ],
      ));

      this.state = PeerState.READY;
      return;
    }
  }

  handleDataMessage(message) {
    const address = Address.from(message.address);

    this.getContentIntegrityVerifier(address).verifyChunk(address, message.data)
      .then(() => {
        this.swarm.chunkBuffer.set(address, message.data);
        this.swarm.availableChunks.set(address);

        const {encoding} = this.swarm;
        this.channel.send(new encoding.Datagram(
          this.remoteId,
          [new encoding.AckMessage(message.address)],
        ));
      })
      .catch((err) => {
        // TODO: update reputation
        console.log('verifier error', err);
      });
  }

  handleHaveMessage(message) {
    const address = Address.from(message.address);

    this.availableChunks.set(address);

    // this.swarm.addAvailableChunk(address);
    const {encoding} = this.swarm;

    const messages = [];
    const {start, end} = address;

    for (let i = start; i <= end; i += 2) {
      const address = new Address(i);
      if (!this.swarm.availableChunks.get(address)) {
        messages.push(new encoding.RequestMessage(encoding.ChunkAddress.from(address)));
      }
    }

    if (message.length !== 0) {
      this.channel.send(new encoding.Datagram(
        this.remoteId,
        messages,
      ));
    }
  }

  handleAckMessage({address}) {
    this.availableChunks.set(Address.from(address));
    // perf timing?
    // clear retransmit timer?
  }

  handleIntegrityMessage(message) {
    const address = Address.from(message.address);
    this.getContentIntegrityVerifier(address).setHash(address, message.hash.value);
  }

  handleSignedIntegrityMessage(message) {
    const address = Address.from(message.address);
    this.getContentIntegrityVerifier(address).setHashSignature(address, message.signature.value);
  }

  // TODO: throttling (request queue/prioritization)
  // TODO: retransmission settings
  // TODO: save sent time for perf
  // TODO: push model?
  handleRequestMessage(message) {
    const address = Address.from(message.address);
    this.sendChunk(address);
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

  sendChunk(address) {
    const chunk = this.swarm.chunkBuffer.get(address);
    if (chunk === undefined) {
      return;
    }

    const {encoding} = this.swarm;
    const messages = [];

    // TODO: omit signatures for bins the peer has already acked
    this.swarm.contentIntegrity.getConstituentSignatures(address)
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

    messages.push(new encoding.DataMessage(encoding.ChunkAddress.from(address), chunk));

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
  }
}

class SwarmMap extends EventEmitter {
  constructor() {
    super();
    this.swarms = {};
  }

  insert(swarm) {
    const id = SwarmMap.swarmIdToKey(swarm.id);
    if (this.swarms[id] === undefined) {
      this.swarms[id] = swarm;
      this.emit('insert', swarm);
    }
  }

  remove(swarm) {
    const id = SwarmMap.swarmIdToKey(swarm.id);
    if (this.swarms[id] !== undefined) {
      delete this.swarms[id];
      this.emit('remove', swarm);
    }
  }

  get(swarmId) {
    return this.swarms[SwarmMap.swarmIdToKey(swarmId)];
  }

  toArray() {
    return Object.values(this.swarms);
  }

  static swarmIdToKey(swarmId) {
    return swarmId.toBuffer().toString('base64');
  }
}

class Client {
  constructor() {
    this.channels = [];

    this.swarms = new SwarmMap();
  }

  publishSwarm(swarm) {
    console.log('published swarm:', swarm.id.toBuffer().toString('base64'));
    this.swarms.insert(swarm);
  }

  unpublishSwarm(swarm) {
    this.swarms.remove(swarm);
  }

  joinSwarm(swarmId) {
    this.swarms.insert(new Swarm(swarmId));
  }

  createChannel(wrtcChannel) {
    const channel = new Channel(wrtcChannel, this.swarms);
    this.channels.push(channel);
  }
}

class Channel extends EventEmitter {
  constructor(channel, swarms) {
    super();

    this.channel = channel;
    this.swarms = swarms;
    this.peers = {};

    this.channel.onopen = this.handleOpen.bind(this);
    this.channel.onmessage = this.handleMessage.bind(this);
    this.channel.onclose = this.handleClose.bind(this);
    this.channel.onerror = err => console.log('channel error:', err);

    this.handleSwarmInsert = this.handleSwarmInsert.bind(this);
    // this.handleSwarmRemove = this.handleSwarmRemove.bind(this);
    this.swarms.on('insert', this.handleSwarmInsert);
    // this.swarms.on('remove', this.handleSwarmRemove);
  }

  handleOpen() {
    this.swarms.toArray().forEach(swarm => {
      // const peer = new Peer(swarm, this);
      // this.peers[peer.localId] = peer;
      // peer.init();
    });
  }

  handleMessage(event) {
    let data = new genericEncoding.Datagram();
    data.read(event.data);

    let peer = this.peers[data.channelId];
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
      const swarm = this.swarms.get(SwarmId.from(swarmId.value));
      if (swarm === undefined) {
        return;
      }

      peer = new Peer(swarm, this);
      this.peers[peer.localId] = peer;
    }

    data = new peer.swarm.encoding.Datagram();
    data.read(event.data);
    peer.handleData(data);
  }

  handleClose() {
    Object.values(this.peers).forEach(peer => peer.close());
  }

  send(data) {
    // console.log('send', data.messages.values);
    this.channel.send(data.toBuffer());
  }

  handleSwarmInsert(swarm) {
    const peer = new Peer(swarm, this);
    this.peers[peer.localId] = peer;
    peer.init();

    const {swarms} = this;
    function handleRemove(removedSwarm) {
      if (removedSwarm === swarm) {
        peer.close();
        swarms.removeEventListener('remove', handleRemove);
      }
    }

    swarms.on('remove', handleRemove);
  }
}

module.exports = {
  Swarm,
  Client,
  Channel,
};

