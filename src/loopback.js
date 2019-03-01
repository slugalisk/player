const ppspp = require('./ppspp');
const dht = require('./dht');
const {EventEmitter} = require('events');
const arrayBufferToHex = require('array-buffer-to-hex');
const createRandomId = require('./utils/createRandomId');

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
    this.remote.remote = this;
    this.onmessage = () => {};
  }

  send(data) {
    setImmediate(() => {
      this.remote.emit('message', {data});
      this.remote.onmessage({data});
    });
  }

  addEventListener(...args) {
    this.on(...args);
  }

  removeEventListener(...args) {
    this.removeListener(...args);
  }

  // TODO: this should do something...?
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
        this.handleConnection(data);
        break;
      default:
        this.emit('error', new Error('unsupported mediator event type'));
    }
  }

  handleConnection({id}) {
    const datachannels = Mediator.datachannels[id];
    delete Mediator.datachannels[id];

    Object.entries(datachannels).forEach(([label, channel]) => this.emit('datachannel', label, channel));
    this.emit('open');
  }

  sendConnection(datachannels) {
    const id = Mediator.nextId ++;
    Mediator.datachannels[id] = datachannels;

    this.conn.send(JSON.stringify({
      type: 'connection',
      id,
    }));

    this.emit('open');
  }
}

Mediator.nextId = 0;
Mediator.datachannels = {};

class Client extends EventEmitter {
  constructor(mediator) {
    super();

    this.mediator = mediator;
    this.datachannels = {};

    mediator.on('datachannel', this.handleDataChannel.bind(this));
    mediator.once('open', this.handleOpen.bind(this));
  }

  handleDataChannel(label, conn) {
    this.emit('datachannel', {label, channel: new ClientDataChannel(this, label, conn)});
  }

  handleOpen() {
    setImmediate(() => this.emit('open'));
  }

  createDataChannel(label) {
    this.datachannels[label] = new ClientDataChannel(this, label);
    return this.datachannels[label];
  }

  init() {
    this.mediator.sendConnection(this.datachannels);
  }
}

class ClientDataChannel extends Conn {
  constructor(client, label, remote) {
    super(remote);

    this.client = client;
    this.label = label;

    this.client.on('open', () => this.emit('open'));
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
