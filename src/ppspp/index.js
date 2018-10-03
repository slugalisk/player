const {EventEmitter} = require('events');
const Address = require('./address');
const SwarmId = require('./swarmid');
const LEDBAT = require('../ledbat');
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
  createLiveSignatureSignFunction,
  createContentIntegrityVerifierFactory,
} = require('./integrity');
const {
  BinRingBuffer,
  Scheduler,
} = require('./scheduler');

const genericEncoding = createEncoding();

const BUFFER_SIZE = 1e7;
const MAX_UPLOAD_RATE = 1e6;

class Swarm {
  constructor(uri, clientOptions) {
    const {swarmId} = uri;
    const {
      [ProtocolOptions.ContentIntegrityProtectionMethod]: contentIntegrityProtectionMethod,
      [ProtocolOptions.MerkleHashTreeFunction]: merkleHashTreeFunction,
      [ProtocolOptions.LiveSignatureAlgorithm]: liveSignatureAlgorithm,
      [ProtocolOptions.ChunkAddressingMethod]: chunkAddressingMethod,
      [ProtocolOptions.ChunkSize]: chunkSize,
    } = uri.protocolOptions;
    const {
      liveDiscardWindow,
      privateKey,
    } = clientOptions;

    this.uri = uri;

    this.encoding = createEncoding(
      createChunkAddressFieldType(chunkAddressingMethod, chunkSize),
      createIntegrityHashFieldType(merkleHashTreeFunction),
      createLiveSignatureFieldType(liveSignatureAlgorithm, swarmId),
    );

    const liveSignatureSignFunction = privateKey !== undefined
      ? createLiveSignatureSignFunction(liveSignatureAlgorithm, privateKey)
      : undefined;
    this.contentIntegrity = createContentIntegrityVerifierFactory(
      contentIntegrityProtectionMethod,
      createMerkleHashTreeFunction(merkleHashTreeFunction),
      createLiveSignatureVerifyFunction(liveSignatureAlgorithm, swarmId),
      liveSignatureSignFunction,
      liveDiscardWindow,
    );

    this.chunkBuffer = new BinRingBuffer(liveDiscardWindow);
    this.scheduler = new Scheduler(chunkSize, clientOptions);

    this.protocolOptions = [
      new this.encoding.VersionProtocolOption(),
      new this.encoding.MinimumVersionProtocolOption(),
      new this.encoding.SwarmIdentifierProtocolOption(swarmId.toBuffer()),
      new this.encoding.ContentIntegrityProtectionMethodProtocolOption(contentIntegrityProtectionMethod),
      new this.encoding.MerkleHashTreeFunctionProtocolOption(merkleHashTreeFunction),
      new this.encoding.LiveSignatureAlgorithmProtocolOption(liveSignatureAlgorithm),
      new this.encoding.ChunkAddressingMethodProtocolOption(chunkAddressingMethod),
      new this.encoding.ChunkSizeProtocolOption(chunkSize),
      new this.encoding.LiveDiscardWindowProtocolOption(liveDiscardWindow),
    ];
  }

  verifyProtocolOptions(protocolOptions) {
    Object.entries(this.uri.protocolOptions)
      .forEach(([protocolOption, value]) => {
        if (protocolOptions[protocolOption] !== value) {
          const protocolOptionName = ProtocolOptions.name(protocolOption);
          throw new Error(`invalid peer options: ${protocolOptionName} mismatch`);
        }
      });
  }
}

const PeerState = {
  CONNECTING: 1,
  AWAITING_HANDSHAKE: 2,
  READY: 3,
  CHOKED: 4,
  DISCONNECTING: 5,
  CLOSED: 6,
};

class PeerDataHandlerContext {
  constructor(swarm) {
    this.swarm = swarm;
    this.integrityVerifier = null;
  }

  getContentIntegrityVerifier(address) {
    if (this.integrityVerifier === null) {
      this.integrityVerifier = this.swarm.contentIntegrity.createVerifier(address);
    }
    return this.integrityVerifier;
  }
}

// TODO: disconnect inactive peers
class Peer {
  constructor(swarm, channel, remoteId = 0, localId = Peer.createChannelId()) {
    this.swarm = swarm;
    this.channel = channel;
    this.remoteId = remoteId;
    this.localId = localId;
    this.state = PeerState.CONNECTING;

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

    this.sendBuffer = [];

    this.swarm.scheduler.addPeer(this);
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

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
    this.state = PeerState.AWAITING_HANDSHAKE;
  }

  close() {
    this.state = PeerState.CLOSED;
    this.swarm.scheduler.removePeer(this);
  }

  handleData(data) {
    const context = new PeerDataHandlerContext(this.swarm);
    data.messages.toArray().forEach(message => this.handleMessage(message, context));
  }

  handleMessage(message, context) {
    const handler = this.handlers[message.type];
    if (handler === undefined) {
      throw new Error('unsupported message type');
    }

    // console.log(MessageTypes.name(message.type), this.remoteId, message);
    handler(message, context);
  }

  handleHandshakeMessage(handshake) {
    const options = handshake.options.reduce((options, {type, value}) => ({...options, [type]: value}), {});

    const liveDiscardWindow = options[ProtocolOptions.LiveDiscardWindow];
    if (liveDiscardWindow !== undefined) {
      this.swarm.scheduler.setLiveDiscardWindow(this, liveDiscardWindow);
    }

    this.swarm.verifyProtocolOptions(options);

    this.remoteId = handshake.channelId;

    if (this.state === PeerState.CONNECTING) {
      const {encoding} = this.swarm;

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
    }

    this.state = PeerState.READY;
  }

  handleDataMessage(message, context) {
    const address = Address.from(message.address);
    const delaySample = LEDBAT.computeOneWayDelay(message.timestamp.value);

    this.swarm.scheduler.markChunkReceived(this, address, delaySample);

    const {encoding} = this.swarm;
    this.sendBuffer.push(new encoding.AckMessage(message.address, new encoding.Timestamp(delaySample)));
    // this.channel.send(new encoding.Datagram(
    //   this.remoteId,
    //   [new encoding.AckMessage(
    //     message.address,
    //     new encoding.Timestamp(delaySample),
    //   )],
    // ));

    context.getContentIntegrityVerifier(address).verifyChunk(address, message.data)
      .then(() => {
        // TODO: use munro to estimate chunk rate
        this.swarm.scheduler.markChunkVerified(this, address);

        this.swarm.chunkBuffer.set(address, message.data);
      })
      .catch((err) => {
        console.log('error validating chunk', err);
        this.swarm.scheduler.markChunkRejected(this, address);
      });
  }

  handleHaveMessage(message) {
    this.swarm.scheduler.markChunkAvailable(this, Address.from(message.address));
  }

  handleAckMessage(message) {
    const address = Address.from(message.address);
    this.swarm.scheduler.markChunkAvailable(this, address);
    this.swarm.scheduler.markSendAcked(this, address, message.delaySample.value);
  }

  handleIntegrityMessage(message, context) {
    const address = Address.from(message.address);
    context.getContentIntegrityVerifier(address).setHash(address, message.hash.value);
  }

  handleSignedIntegrityMessage(message, context) {
    const address = Address.from(message.address);
    context.getContentIntegrityVerifier(address).setHashSignature(address, message.signature.value);
  }

  handleRequestMessage(message) {
    this.swarm.scheduler.enqueueRequest(this, Address.from(message.address));
  }

  handleCancelMessage(message) {
    this.swarm.scheduler.cancelRequest(this, Address.from(message.address));
  }

  handleChokeMessage() {
    this.state = PeerState.CHOKED;
  }

  handleUnchokeMessage() {
    this.state = PeerState.READY;
  }

  isReady() {
    return this.state === PeerState.READY;
  }

  sendHave(address) {
    const {encoding} = this.swarm;

    // this.channel.send(new encoding.Datagram(
    //   this.remoteId,
    //   [new encoding.HaveMessage(encoding.ChunkAddress.from(address))],
    // ));

    this.sendBuffer.push(new encoding.HaveMessage(encoding.ChunkAddress.from(address)));
  }

  sendRequest(...addresses) {
    const {encoding} = this.swarm;
    addresses.forEach(address => {
      this.sendBuffer.push(new encoding.RequestMessage(encoding.ChunkAddress.from(address)));
    });
  }

  sendCancel(...addresses) {
    const {encoding} = this.swarm;
    addresses.forEach(address => {
      this.sendBuffer.push(new encoding.CancelMessage(encoding.ChunkAddress.from(address)));
    });
  }

  sendChunk(address, timestamp) {
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
            new encoding.Timestamp(timestamp),
            new encoding.LiveSignature(signature.getSignatureHash()),
          ));
        }
      });

    messages.push(new encoding.DataMessage(encoding.ChunkAddress.from(address), chunk));

    this.sendBuffer.push(...messages);
    this.flush();
  }

  flush() {
    if (this.sendBuffer.length === 0) {
      return;
    }

    const {encoding} = this.swarm;
    this.channel.send(new encoding.Datagram(this.remoteId, this.sendBuffer));
    this.sendBuffer = [];
  }
}

class SwarmMap extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(Infinity);

    this.swarms = {};
  }

  insert(swarm) {
    const key = SwarmMap.swarmIdToKey(swarm.uri.swarmId);
    if (this.swarms[key] === undefined) {
      this.swarms[key] = swarm;
      this.emit('insert', swarm);
    }
  }

  remove(swarm) {
    const key = SwarmMap.swarmIdToKey(swarm.uri.swarmId);
    if (this.swarms[key] !== undefined) {
      delete this.swarms[key];
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
    this.swarms.insert(swarm);
  }

  unpublishSwarm(swarm) {
    this.swarms.remove(swarm);
  }

  joinSwarm(uri) {
    const chunkSize = uri.protocolOptions[ProtocolOptions.ChunkSize];
    const clientOptions = {
      liveDiscardWindow: Math.ceil(BUFFER_SIZE / chunkSize),
      uploadRateLimit: MAX_UPLOAD_RATE,
    };

    this.swarms.insert(new Swarm(uri, clientOptions));
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

      let handshake;
      try {
        handshake = data.messages.next();
      } catch (error) {
        console.log('error decoding mesasge', error);
        return;
      }
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
    this.swarms.removeListener('insert', this.handleSwarmInsert);
  }

  send(data) {
    this.channel.send(data.toBuffer());
  }

  handleSwarmInsert(swarm) {
    const {peers, swarms} = this;

    const peer = new Peer(swarm, this);
    peers[peer.localId] = peer;
    peer.init();

    function handleRemove(removedSwarm) {
      if (removedSwarm === swarm) {
        delete peers[peer.localId];
        peer.close();

        swarms.removeListener('remove', handleRemove);
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

