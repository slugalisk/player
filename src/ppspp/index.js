import {EventEmitter} from 'events';
import Address from './address';
import SwarmId from './swarmid';
import LEDBAT from '../ledbat';
import {
  createChunkAddressFieldType,
  createLiveSignatureFieldType,
  createIntegrityHashFieldType,
  createEncoding,
} from './encoding';
import {
  MaxChannelId,
  ProtocolOptions,
  MessageTypes,
} from './constants';
import {
  createMerkleHashTreeFunction,
  createLiveSignatureVerifyFunction,
  createLiveSignatureSignFunction,
  createContentIntegrityVerifierFactory,
} from './integrity';
import {
  BinRingBuffer,
  Scheduler,
} from './scheduler';

const genericEncoding = createEncoding();

const BUFFER_SIZE = 1e7;
const MAX_UPLOAD_RATE = 1e6;

export class Swarm extends EventEmitter {
  constructor(uri, clientOptions) {
    super();

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

  emitNewData() {
    const newBins = this.scheduler.getNewCompleteBins();
    if (newBins !== undefined) {
      const [minNewBin, maxNewBin] = newBins;
      const chunks = [];
      for (let i = minNewBin; i <= maxNewBin; i += 2) {
        chunks.push(this.chunkBuffer.get(new Address(i)));
      }
      this.emit('data', chunks);
    }
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
    this.sendHandshake();
    this.flush();

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

    console.log('received handshake message while in state', this.state);
    if (this.state !== PeerState.READY) {
      this.sendHandshake();
      this.swarm.scheduler.getRecentChunks().forEach(address => this.sendHave(address));
      this.flush();
    }

    this.state = PeerState.READY;
  }

  handleDataMessage(message, context) {
    const address = Address.from(message.address);
    const delaySample = LEDBAT.computeOneWayDelay(message.timestamp.value);

    this.swarm.scheduler.markChunkReceived(this, address, delaySample);

    const {encoding} = this.swarm;
    this.channel.send(new encoding.Datagram(
      this.remoteId,
      [new encoding.AckMessage(message.address, new encoding.Timestamp(delaySample))],
    ));

    context.getContentIntegrityVerifier(address).verifyChunk(address, message.data)
      .then(() => {
        this.swarm.chunkBuffer.set(address, message.data);
        this.swarm.scheduler.markChunkVerified(this, address);
        this.swarm.emitNewData();
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

  sendHandshake() {
    const {encoding} = this.swarm;
    this.sendBuffer.push(new encoding.HandshakeMessage(
      this.localId,
      [
        ...this.swarm.protocolOptions,
        new encoding.SupportedMessagesProtocolOption(Object.keys(this.handlers)),
      ],
    ));
  }

  sendHave(address) {
    const {encoding} = this.swarm;
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

    // TODO: omit signatures for bins the peer has already acked
    const constituentSignatures = this.swarm.contentIntegrity.getConstituentSignatures(address);
    if (constituentSignatures === undefined) {
      return;
    }

    const {encoding} = this.swarm;

    constituentSignatures
      .reverse()
      .forEach(({bin, signature}, i) => {
        const address = encoding.ChunkAddress.from(new Address(bin));

        this.sendBuffer.push(new encoding.IntegrityMessage(
          address,
          new encoding.IntegrityHash(signature.getHash()),
        ));

        if (i === 0) {
          this.sendBuffer.push(new encoding.SignedIntegrityMessage(
            address,
            new encoding.Timestamp(timestamp),
            new encoding.LiveSignature(signature.getSignatureHash()),
          ));
        }
      });

    this.sendBuffer.push(new encoding.DataMessage(encoding.ChunkAddress.from(address), chunk));

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

class SwarmSet extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(Infinity);

    this.swarms = {};
  }

  insert(swarm) {
    const key = SwarmSet.swarmIdToKey(swarm.uri.swarmId);
    if (this.swarms[key] === undefined) {
      this.swarms[key] = swarm;
      this.emit('insert', swarm);
    }
  }

  remove(swarm) {
    const key = SwarmSet.swarmIdToKey(swarm.uri.swarmId);
    if (this.swarms[key] !== undefined) {
      delete this.swarms[key];
      this.emit('remove', swarm);
    }
  }

  get(swarmId) {
    return this.swarms[SwarmSet.swarmIdToKey(swarmId)];
  }

  toArray() {
    return Object.values(this.swarms);
  }

  static swarmIdToKey(swarmId) {
    return swarmId.toBuffer().toString('base64');
  }
}

export class Client {
  constructor() {
    this.channels = [];

    this.swarms = new SwarmSet();
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

    const swarm = new Swarm(uri, clientOptions);
    this.swarms.insert(swarm);

    return swarm;
  }

  createChannel(conn) {
    const channel = new Channel(conn, this.swarms);
    this.channels.push(channel);

    channel.once('close', () => {
      const index = this.channels.indexOf(channel);
      this.channels.splice(index, 1);
    });
  }
}

export class Channel extends EventEmitter {
  constructor(conn, swarms) {
    super();

    this.conn = conn;
    this.swarms = swarms;
    this.peers = {};

    this.handleSwarmInsert = this.getOrCreatePeer.bind(this);
    this.swarms.on('insert', this.handleSwarmInsert);

    const liveSwarms = swarms.toArray();
    this.conn.addEventListener('open', () => liveSwarms.forEach(this.handleSwarmInsert));
    this.conn.addEventListener('message', this.handleMessage.bind(this));
    this.conn.addEventListener('error', err => console.log('connection error:', err));
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
        console.log('rejected new peer without handshake');
        return;
      }
      const swarmId = handshake.options.find(({type}) => type === ProtocolOptions.SwarmIdentifier);
      if (swarmId === undefined) {
        console.log('rejecting new peer with invalid swarm id');
        return;
      }
      const swarm = this.swarms.get(SwarmId.from(swarmId.value));
      if (swarm === undefined) {
        console.log('rejecting new peer requesting unknown swarm');
        return;
      }

      peer = this.getOrCreatePeer(swarm);
    }

    data = new peer.swarm.encoding.Datagram();
    data.read(event.data);
    // console.log('RECEIVED', data.messages.toArray());
    peer.handleData(data);
  }

  send(data) {
    try {
      // console.log('SENT', data);
      this.conn.send(data.toBuffer());
    } catch (error) {
      console.log('encountered error while sending', error);
      this.handleClose();
    }
  }

  handleClose() {
    this.swarms.removeListener('insert', this.handleSwarmInsert);
    Object.values(this.peers).forEach(peer => peer.close());
    this.emit('close');
  }

  getOrCreatePeer(swarm) {
    let peer = Object.values(this.peers).find(p => p.swarm === swarm);
    return peer || this.createPeer(swarm);
  }

  createPeer(swarm) {
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

    return peer;
  }
}
