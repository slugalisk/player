const {EventEmitter} = require('events');
const BitArray = require('../bitarray');
const Address = require('./address');
const SwarmId = require('./swarmid');
const hirestime = require('../hirestime');
const wfq = require('../wfq');
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

const genericEncoding = createEncoding();

const BUFFER_SIZE = 1e7;
const MAX_UPLOAD_RATE = 1e6;

class AvailabilityMap {
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new BitArray(capacity * 2);
  }

  // TODO: ignore very large discard windows from remote peers...
  setCapacity(capacity) {
    this.capacity = capacity;
    this.values.resize(capacity * 2);
  }

  set(address) {
    this.values.setRange(address.start, address.end + 1);
  }

  get({bin}) {
    return this.values.get(bin);
  }
}

class BinRing {
  constructor(capacity) {
    this.setCapacity(capacity);
    this.endBin = 0;
  }

  setCapacity(capacity) {
    this.capacity = capacity;
    this.values = new Array(capacity);

    for (let i = 0; i < capacity; i ++) {
      this.values[i] = this.createEmptyValue(i);
    }
  }

  advanceEndBin(bin) {
    for (let i = this.endBin; i <= bin; i += 2) {
      const index = (i / 2) % this.capacity;
      this.values[index] = this.createEmptyValue(i, this.values[index]);
    }
    this.endBin = bin + 2;
  }

  createEmptyValue() {
    return undefined;
  }

  set({bin, start, end}, value) {
    if (Array.isArray(value)) {
      this.advanceEndBin(end);
      for (let i = 0; i < value.length; i ++) {
        this.values[(start / 2 + i) % this.capacity] = value[i];
      }
    } else {
      this.advanceEndBin(bin);
      this.values[(bin / 2) % this.capacity] = value;
    }
  }

  get({bin}) {
    if (bin < this.endBin - this.capacity * 2 || bin >= this.endBin) {
      return undefined;
    }
    return this.values[(bin / 2) % this.capacity];
  }

  forEach(callback) {
    for (let i = this.endBin - this.capacity * 2; i < this.endBin; i += 2) {
      callback(this.values[(i / 2) % this.capacity], i);
    }
  }
}

class EMA {
  constructor(alpha) {
    this.mean = 0;
    this.alpha = alpha;
    this.weight = 1;
  }

  update(value) {
    this.mean = this.mean * this.alpha + (1 - this.alpha) * value;
    this.weight *= this.alpha;
  }

  value() {
    return this.mean / (1 - this.weight);
  }
}

class RateMeter {
  constructor(windowMs, sampleWindowMs = 100) {
    this.firstSampleWindow = Math.floor(Date.now() / sampleWindowMs);
    this.lastSampleWindow = this.firstSampleWindow;
    this.windowMs = windowMs;
    this.sampleWindowMs = sampleWindowMs;
    this.sum = 0;
    this.values = new Array(windowMs / sampleWindowMs);

    this.values.fill(0);
  }

  update(value) {
    const sampleWindow = Math.floor(Date.now() / this.sampleWindowMs);

    for (let i = this.lastSampleWindow + 1; i <= sampleWindow; i += this.sampleWindowMs) {
      const index = i % this.values.length;
      this.sum -= this.values[index];
      this.values[index] = 0;
    }
    this.lastSampleWindow = sampleWindow;

    this.sum += value;
    this.values[sampleWindow % this.values.length] += value;
  }

  value() {
    const accumulatedMs = Math.min(
      (this.lastSampleWindow - this.firstSampleWindow) * this.sampleWindowMs,
      this.windowMs,
    );
    return this.sum / accumulatedMs;
  }
}

class ChunkRateMeter extends RateMeter {
  constructor(windowMs = 15000) {
    super(windowMs);
    this.lastEndBin = 0;
  }

  update({start, end}) {
    if (this.lastHeadBin === 0) {
      super.update((end - start) / 2);
    } else if (end > this.lastEndBin) {
      super.update((end - this.lastEndBin) / 2);
      this.lastEndBin = end;
    }
  }
}

class RequestFlow extends wfq.Flow {
  constructor(id) {
    super();
    this.id = id;
    this.queueSize = 0;
  }

  computeWeight(queue) {
    return this.queueSize / queue.totalQueueSize;
  }
}

class RequestQueue extends wfq.Queue {
  constructor(rate) {
    super(rate);
    this.totalQueueSize = 0;
  }

  enqueue(flow, size, value) {
    this.totalQueueSize += size;
    flow.queueSize += size;
    super.enqueue(flow, size, value);
  }

  cancel(flow, filter) {
    flow.queue = flow.queue.filter(task => {
      const remove = filter(task.value);

      if (remove) {
        this.totalQueueSize -= task.size;
        flow.queueSize -= task.size;
      }

      return !remove;
    });
  }

  dequeue() {
    const result = super.dequeue();
    if (result === null) {
      return null;
    }

    this.totalQueueSize -= result.task.size;
    result.flow.queueSize -= result.task.size;

    return result;
  }
}

class SchedulerChunkState {
  constructor(bin) {
    this.bin = bin;
    this.reset();
  }

  reset() {
    this.availableCopies = 0;
    this.requestTime = [0, 0];
    this.requestPeerId = 0;

    this.requested = false;
    this.received = false;
    this.verified = false;
  }
}

class SchedulerChunkMap extends BinRing {
  createEmptyValue(bin, value) {
    if (value === undefined) {
      return new SchedulerChunkState(bin);
    }

    // put the peer map here and when we advance the bin meme update
    // the availability map here

    value.reset();
    return value;
  }
}

class SchedulerPeerState {
  constructor(peer, requestFlow) {
    this.peer = peer;
    this.requestFlow = requestFlow;
    this.availableChunks = new AvailabilityMap();
    this.requestLatency = new EMA(0.05);
    this.sendLatency = new EMA(0.05);

    this.timeouts = 0;
    this.validChunks = 0;
    this.invalidChunks = 0;
  }
}

class Scheduler {
  constructor(chunkSize, clientOptions) {
    const {
      liveDiscardWindow,
      uploadRateLimit,
    } = clientOptions;

    this.chunkSize = chunkSize;

    // where are we in the buffer

    // how rare is a chunk
    // how urgently is a chunk needed

    // high/mid/low priority time bands

    // high performance/reliability peers
    // expected performance per peer

    // request timeout/cancel
    // send timeout/cancel?

    this.peerStates = {};
    this.chunkStates = new SchedulerChunkMap(liveDiscardWindow);
    this.loadedChunks = new AvailabilityMap(liveDiscardWindow);
    this.peerCount = 0;
    // this.windowStart = 0;
    // this.windowEnd = 0;
    this.chunkRate = new ChunkRateMeter();
    this.requestedChunks = [];
    // average stream bit rate
    // position in available window
    // position in theoretical window

    // how do we know what range we want urgently...? we sort of need to
    // know the video bitrate...

    // do we just want to look at have range * chunk size / time?

    this.finishedUpToBin = 0;
    this.lastAvailableBin = 0;

    // minimum needed bin

    this.requestQueue = new RequestQueue(uploadRateLimit / 1000);
  }

  start() {
    this.updateIvl = setInterval(this.update.bind(this), 1000);
  }

  stop() {
    clearInterval(this.updateIvl);
  }

  scoreBin(bin) {

  }

  update() {
    // this.chunkStates.forEach((chunk, bin) => console.log({chunk, bin}));

    // how far back do we need to be from the head to absorb jitter?


    let totalSize = 0;
    // eslint-disable-next-line
    while (true) {
      const result = this.requestQueue.dequeue();
      if (result === null) {
        break;
      }

      const {
        flow: {id: peerId},
        task: {
          size,
          value: address,
        },
      } = result;

      for (let i = address.start; i <= address.end; i += 2) {
        this.peerStates[peerId].peer.sendChunk(new Address(i));
      }

      totalSize += size;

      // sum sent bytes and break when we hit 10ms quota
    }

    if (totalSize > 0) {
      console.log(totalSize);
    }
  }

  reschedule(address) {

  }

  requestSomething() {
    // do we have urgently needed chunks that have not yet been requested?
    // - request them from TOP PEERS

    // ...some window size
  }

  addPeer(peer) {
    const {localId} = peer;

    const requestFlow = new RequestFlow(localId);
    this.requestQueue.addFlow(requestFlow);

    this.peerStates[localId] = new SchedulerPeerState(peer, requestFlow);

    if (++ this.peerCount === 1) {
      this.start();
    }
  }

  removePeer({localId}) {
    const peerState = this.peerStates[localId];
    if (peerState === undefined) {
      return;
    }

    const {requestFlow} = peerState;
    this.requestQueue.removeFlow(requestFlow);

    delete this.peerStates[localId];

    if (-- this.peerCount === 0) {
      this.stop();
    }
  }

  getPeerState({localId}) {
    return this.peerStates[localId];
  }

  setLiveDiscardWindow(peer, liveDiscardWindow) {
    this.getPeerState(peer).availableChunks.setCapacity(liveDiscardWindow);
  }

  markChunkReceived({localId}, address) {
    // const chunk = this.chunkStates.get(address);
    // if (chunk.requestedPeerId === localId) {
    //   this.peerStates[localId].requestLatency.update(hirestime.since(chunk.requestTime));
    // }

    // chunk.received = true;
  }

  markChunkVerified({localId}, address) {
    // this.chunkStates.get(address).verified = true;
    this.peerStates[localId].validChunks ++;

    // this.chunkStates.advanceEndBin(address.end);

    this.chunkRate.update(address);

    Object.values(this.peerStates).forEach(({availableChunks, peer}) => {
      if (!availableChunks.get(address)) {
        peer.sendHave(address);
      }
    });
  }

  markChunkRejected({localId}, address) {
    this.reschedule(address);
    this.peerStates[localId].invalidChunks ++;
  }

  markChunkAvailable({localId}, address) {
    this.peerStates[localId].availableChunks.set(address);

    if (typeof window !== 'undefined') {
      this.peerStates[localId].peer.sendRequest(address);
    }
  }

  markChunksLoaded(address) {
    this.chunkStates.advanceEndBin(address.end);

    Object.values(this.peerStates).forEach(({peer}) => peer.sendHave(address));
  }

  updateDelayStats({localId}, timestamp) {
    this.peerStates[localId].sendLatency.update(hirestime.since(timestamp));
  }

  enqueueRequest({localId}, address) {
    this.requestQueue.enqueue(
      this.peerStates[localId].requestFlow,
      this.chunkSize * (address.end - address.start + 1),
      address,
    );
  }

  cancelRequest({localId}, address) {
    this.requestQueue.cancel(
      this.peerStates[localId].requestFlow,
      ({bin}) => address.containsBin(bin),
    );
  }
}

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

    this.chunkBuffer = new BinRing(liveDiscardWindow);
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

    // this.handleAvailableDataSet = this.handleAvailableDataSet.bind(this);
    // swarm.availableChunks.on('set', this.handleAvailableDataSet);

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

    // if (this.swarm.hasData()) {
    //   messages.push(new encoding.ChokeMessage());
    // }

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
    this.state = PeerState.AWAITING_HANDSHAKE;
  }

  close() {
    this.swarm.scheduler.removePeer(this);
    // this.swarm.availableChunks.removeEventListener('set', this.handleAvailableDataSet);
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

    this.swarm.scheduler.markChunkReceived(this, address);

    const {encoding} = this.swarm;
    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.AckMessage(message.address, message.timestamp)],
    ));

    context.getContentIntegrityVerifier(address).verifyChunk(address, message.data)
      .then(() => {
        this.swarm.scheduler.markChunkVerified(this, address);

        this.swarm.chunkBuffer.set(address, message.data);
        this.swarm.availableChunks.set(address);
      })
      .catch((err) => {
        this.swarm.scheduler.markChunkRejected(this, address);
      });
  }

  handleHaveMessage(message) {
    this.swarm.scheduler.markChunkAvailable(this, Address.from(message.address));
  }

  handleAckMessage(message) {
    this.swarm.scheduler.markChunkAvailable(this, Address.from(message.address));
    this.swarm.scheduler.updateDelayStats(this, message.delaySample.value);
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

  sendHave(address) {
    const {encoding} = this.swarm;

    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.HaveMessage(encoding.ChunkAddress.from(address))],
    ));
  }

  sendRequest(address) {
    const {encoding} = this.swarm;

    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.RequestMessage(encoding.ChunkAddress.from(address))],
    ));
  }

  sendCancel(address) {
    const {encoding} = this.swarm;
    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.CancelMessage(encoding.ChunkAddress.from(address))],
    ));
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

    this.channel.send(new encoding.Datagram(this.remoteId, messages));
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

