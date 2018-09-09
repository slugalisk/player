const { EventEmitter } = require('events');
// const { Buffer } = require('buffer');
// const hirestime = require('../hirestime');
const LRU = require('lru-cache');
// const crypto = require('crypto');
// const arrayEqual = require('array-equal');
// const bins = require('../bins');

// const CHUNK_SIZE = 64000;
// const NCHUNKS_PER_SIG = 16;

const {
  MaxChannelId,
  MessageTypes,
} = require('./constants');

class Swarm {
  constructor() {

  }
}

class Peer {
  constructor(swarm, channel, id = Peer.createChannelId()) {
    this.swarm = swarm;
    this.channel = channel;
    this.id = id;
  }

  static createChannelId() {
    return Math.round(Math.random() * MaxChannelId);
  }

  init() {
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
          ],
        ),
      ],
    );
    channel.send(data);
  }

  handleMessage(message) {
    switch (message.type) {
      case MessageTypes.HANDSHAKE:
        this.handleHandshake(channel, message);
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
    }
  }

  handleHandshake(channel, handshake) {
    // we sent a handshake and this is the response
    // - we are already in this swarm
    // - we are joining this swarm for the first time
    // we are receiving a handshake request
    // - we are in this swarm
    // - we are not in this swarm

    // const options = handshake.options.reduce((options, option) => ({...options, [option.type]: option}), {});

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

    this.swarms = {};
    this.peer = {};
  }

  publishSwarm(swarm) {
    this.swarms[swarm.id] = swarm;
  }

  addChannel(channel) {
    this.channels.push(channel);

    const peers = {};

    channel.once('open', () => {
      Object.values(this.memeHub.swarms).forEach(swarm => {
        const peer = new Peer(swarm, channel);
        peers[peer.id] = peer;
        peer.init();
      });
    });

    channel.once('close', () => {
      Object.values(peers).forEach(peer => peer.close());
    });

    channel.on('data', ({channelId, messages}) => {
      let peer = peers[channelId];
      if (peer === undefined) {
        const handshake = messages.find(({type}) => type === MessageTypes.HANDSHAKE);
        if (handshake === undefined) {
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

      messages.forEach(message => peer.handleMessage(message));
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
    this.emit('data', data);
  }

  handleClose() {
    this.emit('close');
  }

  send(data) {
    this.channel.send(data.toBuffer());
  }
}

module.exports = {
  Client,
  Channel,
};

