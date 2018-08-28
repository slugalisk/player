const { EventEmitter } = require('events');
const {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} = require('wrtc');

class Mediator extends EventEmitter {
  constructor(conn) {
    super();

    this.conn = conn;
    this.conn.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'offer') {
        this.emit('remotedescription', new RTCSessionDescription(data));
      } else if (data.type === 'answer') {
        this.emit('remotedescription', new RTCSessionDescription(data));
      } else if (data.type === 'icecandidate') {
        if (data.sdp && data.sdp.candidate) {
          this.emit('icecandidate', new RTCIceCandidate(data.sdp));
        }
      }
    };
  }

  sendOffer(event) {
    this.conn.send(JSON.stringify(event));
  }

  sendAnswer(event) {
    this.conn.send(JSON.stringify(event));
  }

  sendIceCandidate(event) {
    if (event.candidate) {
      this.conn.send(JSON.stringify({
        type: 'icecandidate',
        sdp: event.candidate,
      }));
    }
  }
}

class Client extends EventEmitter {
  constructor(mediator) {
    super();

    this.mediator = mediator;
    this.initialized = false;
    this.waitingChannels = 0;

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.pc.onicecandidate = candidate => this.mediator.sendIceCandidate(candidate);
    this.pc.ondatachannel = this.handleDataChannel.bind(this);

    mediator.on('icecandidate', candidate => this.addIceCandidate(candidate))

    this._ready = new Promise((resolve, reject) => {
      mediator.on('remotedescription', description => {
        this.pc.setRemoteDescription(description)
          .then(() => {
            resolve();
            this.createAnswer();
          })
          .catch(err => console.error(err));
      });
    });
  }

  createAnswer() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.pc.createAnswer()
      .then((description) => {
        this.pc.setLocalDescription(description);
        this.mediator.sendAnswer(description);
      })
      .catch(err => console.error(err));
  }

  addIceCandidate(candidate) {
    this._ready.then(() => this.pc.addIceCandidate(candidate));
  }

  handleDataChannel(event) {
    this.waitingChannels ++;
    event.channel.addEventListener('open', this.resolveWaitingChannel.bind(this), {once: true});

    this.emit('datachannel', event)
  }

  createDataChannel(label, options = {}) {
    options = {
      ...options,
      ordered: false,
      maxRetransmits: 10,
    };

    const channel = this.pc.createDataChannel(label, options);

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
    this.pc.createOffer()
      .then(offer => {
        this.initialized = true;
        console.log('initial offer', offer);
        this.pc.setLocalDescription(offer);
        this.mediator.sendOffer(offer);
      });
  }
}

module.exports = {
  Mediator,
  Client,
};
