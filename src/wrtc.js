const {EventEmitter} = require('events');
const {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} = require('wrtc');

class ConnManager {
  constructor(bootstrapAddress) {
    this.bootstrapAddress = bootstrapAddress;
  }

  bootstrap() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const conn = new WebSocket(`${protocol}://${this.bootstrapAddress}`);
      conn.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'bootstrap') {
          resolve({data, conn});
        } else {
          reject(new Error(`expected bootstrap, received: ${event.data}`));
        }
      };
    });
  }

  createClient(conn) {
    const mediator = new Mediator(conn);
    const client = new Client(mediator);

    // TODO: retry?
    mediator.once('error', () => conn.close());
    client.once('open', () => conn.close());

    return client;
  }
}

class Mediator extends EventEmitter {
  constructor(conn) {
    super();

    this.conn = conn;
    this.conn.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'offer':
      case 'answer':
        this.emit('remotedescription', new RTCSessionDescription(data));
        break;
      case 'icecandidate':
        if (data.sdp && data.sdp.candidate) {
          this.emit('icecandidate', new RTCIceCandidate(data.sdp));
        }
        break;
      default:
        this.emit('error', new Error('unsupported mediator event type'));
    }
  }

  sendOffer(event) {
    this.send(event);
  }

  sendAnswer(event) {
    this.send(event);
  }

  sendIceCandidate(event) {
    if (event.candidate) {
      this.send({
        type: 'icecandidate',
        sdp: event.candidate,
      });
    }
  }

  send(event) {
    if (this.conn.readyState !== 1) {
      this.emit('error', new Error('connection in invalid state'));
      return;
    }

    this.conn.send(JSON.stringify(event));
  }
}

class Client extends EventEmitter {
  constructor(mediator) {
    super();

    this.mediator = mediator;
    this.initialized = false;
    this.waitingChannels = 0;

    this.peerConn = new RTCPeerConnection({
      iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
    });

    this.peerConn.addEventListener('icecandidate', candidate => this.mediator.sendIceCandidate(candidate));
    this.peerConn.addEventListener('datachannel', this.handleDataChannel.bind(this));

    mediator.once('error', () => this.peerConn.close());
    mediator.on('icecandidate', candidate => this.addIceCandidate(candidate));

    this._ready = new Promise((resolve, reject) => {
      mediator.on('remotedescription', description => {
        this.peerConn.setRemoteDescription(description)
          .then(() => {
            resolve();
            this.createAnswer();
          })
          .catch(reject);
      });
    });
  }

  createAnswer() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.peerConn.createAnswer()
      .then((description) => {
        this.peerConn.setLocalDescription(description);
        this.mediator.sendAnswer(description);
      })
      .catch(error => console.error(error));
  }

  addIceCandidate(candidate) {
    this._ready.then(() => this.peerConn.addIceCandidate(candidate));
  }

  handleDataChannel(event) {
    this.waitingChannels ++;
    event.channel.addEventListener('open', this.resolveWaitingChannel.bind(this), {once: true});

    this.emit('datachannel', event);
  }

  createDataChannel(label, options = {}) {
    options = {
      ordered: true,
      maxRetransmits: 10,
      ...options,
    };

    const channel = this.peerConn.createDataChannel(label, options);
    channel.binaryType = 'arraybuffer';

    this.waitingChannels ++;
    channel.addEventListener('open', this.resolveWaitingChannel.bind(this), {once: true});

    return channel;
  }

  resolveWaitingChannel() {
    if (-- this.waitingChannels === 0) {
      this.emit('open');
    }
  }

  init() {
    this.peerConn.createOffer()
      .then(offer => {
        this.initialized = true;
        // console.log('initial offer', offer);
        this.peerConn.setLocalDescription(offer);
        this.mediator.sendOffer(offer);
      });
  }
}

module.exports = {
  ConnManager,
  Mediator,
  Client,
};
