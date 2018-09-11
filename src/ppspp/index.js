const { EventEmitter } = require('events');
// const { Buffer } = require('buffer');
// const hirestime = require('../hirestime');
// const LRU = require('lru-cache');
// const crypto = require('crypto');
// const arrayEqual = require('array-equal');
// const bins = require('../bins');

// const CHUNK_SIZE = 64000;
// const NCHUNKS_PER_SIG = 16;

const {
  // createChunkAddressFieldType,
  // createLiveSignatureFieldType,
  // createIntegrityHashFieldType,
  createEncoding,
} = require('./encoding');

const {
  MaxChannelId,
  ProtocolOptions,
  // Version,
  // ContentIntegrityProtectionMethod,
  // MerkleHashTreeFunction,
  // LiveSignatureAlgorithm,
  // ChunkAddressingMethod,
  // VariableChunkSize,
  MessageTypes,
  SupportedMessageTypes,
} = require('./constants');

const {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrity,
} = require('./integrity');

class Swarm {
  constructor(encoding = createEncoding()) {
    this.encoding = encoding;
  }
}

class Peer {
  constructor(swarm, channel, remoteId = 0, localId = Peer.createChannelId()) {
    this.swarm = swarm;
    this.channel = channel;
    this.remoteId = remoteId;
    this.localId = localId;
  }

  static createChannelId() {
    return Math.round(Math.random() * MaxChannelId);
  }

  init() {
    const {encoding} = this.swarm;
    const data = new encoding.Datagram(
      this.remoteId,
      [
        new encoding.HandshakeMessage(
          this.localId,
          [
            new encoding.VersionProtocolOption(),
            new encoding.MinimumVersionProtocolOption(),
            new encoding.SwarmIdentifierProtocolOption(this.swarm.id),
            new encoding.LiveDiscardWindowProtocolOption(6000),
            new encoding.SupportedMessagesProtocolOption(),
          ],
        ),
      ],
    );
    this.channel.send(data);
  }

  handleMessage(message) {
    switch (message.type) {
      case MessageTypes.HANDSHAKE:
        this.handleHandshake(message);
        break;
      case MessageTypes.DATA:
        console.log('DATA', message);
        break;
      case MessageTypes.HAVE:
        console.log('HAVE', message);
        break;
      case MessageTypes.ACK:
        console.log('ACK', message);
        break;
      case MessageTypes.INTEGRITY:
        console.log('INTEGRITY', message);
        break;
      case MessageTypes.SIGNED_INTEGRITY:
        console.log('SIGNED_INTEGRITY', message);
        break;
      case MessageTypes.REQUEST:
        console.log('REQUEST', message);
        break;
      case MessageTypes.CANCEL:
        console.log('CANCEL', message);
        break;
      case MessageTypes.CHOKE:
        console.log('CHOKE', message);
        break;
      case MessageTypes.UNCHOKE:
        console.log('UNCHOKE', message);
        break;
      default:
        throw new Error('unsupported message type');
    }
  }

  handleHandshake(handshake) {
    // we sent a handshake and this is the response
    // - we are already in this swarm
    // - we are joining this swarm for the first time
    // we are receiving a handshake request
    // - we are in this swarm
    // - we are not in this swarm

    // const options = handshake.options.reduce((options, option) => ({...options, [option.type]: option}), {});

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
            new encoding.SupportedMessagesProtocolOption(SupportedMessageTypes),
          ]
        ),
      ],
    );
    this.channel.send(data);
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

