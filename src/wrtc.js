import {EventEmitter} from 'events';
import WebSocket from './compat/ws';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from './compat/wrtc';

export class ConnManager {
  constructor(bootstrapAddress) {
    this.bootstrapAddress = bootstrapAddress;
  }

  bootstrap() {
    return new Promise((resolve, reject) => {
      const conn = new WebSocket(this.bootstrapAddress);
      conn.onerror = reject;
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

    // firefox seems to continue generating ice messages after the datachannel
    // has opened...
    mediator.once('error', () => conn.close());
    client.once('open', () => conn.close());

    return client;
  }
}

export class Mediator extends EventEmitter {
  constructor(conn) {
    super();

    this.conn = conn;
    this.conn.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const data = JSON.parse(event.data);
    // console.log('mediator message', data);

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
      console.log('mediator tried to send after closing its connection');
      // console.log('send error', this.conn);
      // console.trace();
      // this.emit('error', new Error('connection in invalid state'));
      return;
    }

    this.conn.send(JSON.stringify(event));
  }
}

export class Client extends EventEmitter {
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
    this.peerConn.addEventListener('iceconnectionstatechange', this.handleIceConnectionStateChange.bind(this));

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
    // event.channel.addEventListener('close', e => console.log('< begin close event handlers'));
    event.channel.binaryType = 'arraybuffer';

    this.waitingChannels ++;
    event.channel.addEventListener('open', this.resolveWaitingChannel.bind(this), {once: true});

    // console.log('< received data channel', event);
    // event.channel.addEventListener('error', e => console.log('< data channel emitted error', e));
    // event.channel.addEventListener('open', e => console.log('< data channel opened', e));
    // event.channel.addEventListener('bufferedamountlow', e => console.log('< data channel bufferamountlow', e));
    // event.channel.addEventListener('close', e => console.log('< data channel closed', e));

    this.emit('datachannel', event);
  }

  createDataChannel(label, options = {}) {
    options = {
      ordered: true,
      maxRetransmits: 10,
      ...options,
    };

    const channel = this.peerConn.createDataChannel(label, options);
    // channel.addEventListener('close', e => console.log('> begin close event handlers'));
    channel.binaryType = 'arraybuffer';

    this.waitingChannels ++;
    channel.addEventListener('open', this.resolveWaitingChannel.bind(this), {once: true});

    // console.log('> received data channel', {channel});
    // channel.addEventListener('error', e => console.log('> data channel emitted error', e));
    // channel.addEventListener('open', e => console.log('> data channel opened', e));
    // channel.addEventListener('bufferedamountlow', e => console.log('> data channel bufferedamountlow', e));
    // channel.addEventListener('close', e => console.log('> data channel closed', e));

    return channel;
  }

  resolveWaitingChannel() {
    if (-- this.waitingChannels === 0) {
      this.emit('open');
    }
  }

  handleIceConnectionStateChange() {
    // this seems to be the most reliable way to get connection state in chrome
    if (this.peerConn.iceConnectionState === 'failed') {
      this.peerConn.close();
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

  close() {
    // console.log('wrtc client closed');
    // console.trace();
    this.peerConn.close();
    this.emit('close');
  }
}
