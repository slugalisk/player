const ppspp = require('./ppspp');
const dht = require('./dht');
const wrtc = require('./wrtc');
const hexToUint8Array = require('./hexToUint8Array');

export class ConnManager {
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
    const mediator = new wrtc.Mediator(conn);
    const client = new wrtc.Client(mediator);

    // TODO: retry?
    mediator.once('error', () => conn.close());
    client.once('open', () => conn.close());

    return client;
  }
}

export class ClientManager {
  constructor(connManager) {
    this.connManager = connManager;
    this.ppsppClient = new ppspp.Client();
  }

  createClient() {
    return this.connManager.bootstrap().then(({data, conn}) => {
      this.initDht(data, conn);
      return {
        ppsppClient: this.ppsppClient,
        swarmUri: data.swarmUri,
      };
    });
  }

  initDht(data, conn) {
    this.dhtClient = new dht.Client(hexToUint8Array(data.id));
    this.dhtClient.on('peers.discover', this.handlePeersDiscover.bind(this));
    this.dhtClient.on('receive.connect.request', this.handleReceiveConnectRequest.bind(this));

    const client = this.connManager.createClient(conn);

    const bootstrapId = hexToUint8Array(data.bootstrapId);
    this.dhtClient.createChannel(bootstrapId, client.createDataChannel('dht'));
    this.ppsppClient.createChannel(client.createDataChannel('ppspp'));

    client.init();
  }

  handlePeersDiscover(ids) {
    ids.forEach(id => {
      const sub = new dht.SubChannel(this.dhtClient, id);
      const client = this.connManager.createClient(sub);

      this.dhtClient.createChannel(id, client.createDataChannel('dht'));
      this.ppsppClient.createChannel(client.createDataChannel('ppspp'));

      this.dhtClient.send(id, 'connect.request', {channelId: sub.id}, () => client.init());
    });
  }

  handleReceiveConnectRequest({data: {channelId, from}, callback}) {
    console.log('handleReceiveConnectRequest', {channelId, from, callback});
    const id = new hexToUint8Array(from);
    const client = this.connManager.createClient(new dht.SubChannel(this.dhtClient, id, channelId));

    client.on('datachannel', ({channel}) => {
      if (channel.label === 'dht') {
        this.dhtClient.createChannel(id, channel);
      } else if (channel.label === 'ppspp') {
        this.ppsppClient.createChannel(channel);
      }
    });

    callback();
  }
}
