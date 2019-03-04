import * as ppspp from './ppspp';
import * as dht from './dht';
import {EventEmitter} from 'events';
import arrayBufferToHex from 'array-buffer-to-hex';
import createRandomId from './utils/createRandomId';

export class Server {
  constructor() {
    this.dhtClient = new dht.Client(createRandomId());
    this.ppsppClient = new ppspp.Client();
  }
}

const queue = [];

export class ConnManager {
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

    queue.push(client);
    if (queue.length > 11) {
      queue.shift().close();
    }
    // setTimeout(() => client.close(), Math.random() * 30000);

    return Promise.resolve({data, conn: conn.remote});
  }

  createClient(conn) {
    const mediator = new Mediator(conn);
    const client = new Client(mediator);

    mediator.on('connection', () => conn.close());

    return client;
  }
}

export class Conn extends EventEmitter {
  constructor(remote) {
    super();
    this.remote = remote || new Conn(this);
    this.remote.remote = this;
    this.onmessage = () => {};
    this.closed = false;
  }

  send(data) {
    if (!this.closed) {
      setImmediate(() => {
        this.remote.emit('message', {data});
        this.remote.onmessage({data});
      });
    }
  }

  addEventListener(...args) {
    this.on(...args);
  }

  removeEventListener(...args) {
    this.removeListener(...args);
  }

  close() {
    this.closed = true;
    this.remote.emit('close');
    this.emit('close');
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

export class Client extends EventEmitter {
  constructor(mediator) {
    super();

    this.mediator = mediator;
    this.datachannels = {};
    this.conns = [];

    mediator.on('datachannel', this.handleDataChannel.bind(this));
    mediator.once('open', this.handleOpen.bind(this));
  }

  handleDataChannel(label, conn) {
    const channel = new ClientDataChannel(this, label, conn);
    this.conns.push(channel);
    this.emit('datachannel', {label, channel});
  }

  handleOpen() {
    setImmediate(() => this.emit('open'));
  }

  createDataChannel(label) {
    const channel = new ClientDataChannel(this, label);
    this.datachannels[label] = channel;
    this.conns.push(channel);
    return channel;
  }

  init() {
    this.mediator.sendConnection(this.datachannels);
  }

  close() {
    this.conns.forEach(conn => conn.close());
    this.emit('close');
  }
}

export class ClientDataChannel extends Conn {
  constructor(client, label, remote) {
    super(remote);

    this.client = client;
    this.label = label;
    this.open = false;

    this.client.on('open', () => {
      this.emit('open');
      this.open = true;
    });
  }
}
