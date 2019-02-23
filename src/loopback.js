const ppspp = require('./ppspp');
const dht = require('./dht');
const crypto = require('crypto');
const {EventEmitter} = require('events');
const arrayBufferToHex = require('array-buffer-to-hex');

const createRandomId = () => {
  const id = new Uint8Array(16);
  crypto.randomFillSync(id);
  return id;
};

class Server {
  constructor() {
    this.dhtClient = new dht.Client(createRandomId());
    this.ppsppClient = new ppspp.Client();
  }
}

class ConnManager {
  constructor(server) {
    this.server = server;
  }

  bootstrap() {
    const id = createRandomId();

    const data = {
      type: 'bootstrap',
      bootstrapId: arrayBufferToHex(this.server.dhtClient.id),
      id: arrayBufferToHex(id),
    };
    const conn = new Conn();
    const client = this.createClient(conn);

    client.on('datachannel', ({channel}) => {
      if (channel.label === 'dht') {
        this.server.dhtClient.createChannel(id, channel);
      } else if (channel.label === 'ppspp') {
        this.server.ppsppClient.createChannel(channel);
      }
    });

    return Promise.resolve({data, conn: conn.remote});
  }

  createClient(conn) {
    const mediator = new Mediator(conn);
    const client = new Client(mediator);

    mediator.on('connection', () => conn.close());

    return client;
  }
}

class Conn extends EventEmitter {
  constructor(remote) {
    super();
    this.remote = remote || new Conn(this);
    this.onmessage = () => {};
  }

  send(data) {
    this.remote.emit('message', {data});
    this.remote.onmessage({data});
  }

  close() {}
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
      case 'connection':
        data.datachannels.forEach(label => this.emit('datachannel', label));
        this.emit('connection', Mediator.conns[data.id]);
        this.emit('open', Mediator.conns[data.id]);
        delete Mediator.conns[data.id];
        break;
      default:
        this.emit('error', new Error('unsupported mediator event type'));
    }
  }

  sendConnection(conn, datachannels) {
    this.emit('connection', conn);

    const id = Mediator.nextId ++;
    Mediator.conns[id] = conn.remote;

    this.conn.send(JSON.stringify({
      type: 'connection',
      id,
      datachannels,
    }));

    this.emit('open', conn);
  }
}

Mediator.nextId = 0;
Mediator.conns = {};

class Client extends EventEmitter {
  constructor(mediator) {
    super();

    this.mediator = mediator;
    this.conn = null;
    this.datachannels = {};

    mediator.on('datachannel', this.handleDataChannel.bind(this));
    mediator.once('connection', this.handleConnection.bind(this));
    mediator.once('open', () => this.handleOpen.bind(this));
  }

  handleDataChannel(label) {
    this.datachannels[label] = new ClientDataChannel(this, label);
    this.emit('datachannel', {channel: this.datachannels[label]});
  }

  handleConnection(conn) {
    this.conn = conn;
    conn.client = this;
  }

  handleOpen() {
    setImmediate(() => this.emit('open'));
  }

  createDataChannel(label) {
    this.datachannels[label] = new ClientDataChannel(this, label);
    return this.datachannels[label];
  }

  init() {
    this.mediator.sendConnection(new Conn(), Object.keys(this.datachannels));
  }
}

class ClientDataChannel extends EventEmitter {
  constructor(client, label) {
    super();

    this.client = client;
    this.label = label;

    this.client.on('open', () => this.emit('open'));
    this.send = this.send.bind(this);
  }

  send(data) {
    setImmediate(() => this.client.conn.remote.client.datachannels[this.label].emit('message', {data}));
  }

  addEventListener(...args) {
    this.on(...args);
  }

  removeEventListener(...args) {
    this.removeListener(...args);
  }
}

module.exports = {
  Server,
  ConnManager,
  Conn,
  Mediator,
  Client,
  ClientDataChannel,
};
