import * as ppspp from './ppspp';
import * as dht from './dht';
import hexToUint8Array from './hexToUint8Array';

export class Client {
  constructor(connManager, dhtClientId, bootstrapId, conn, swarmUri) {
    this.connManager = connManager;
    this.swarmUri = swarmUri;

    const client = connManager.createClient(conn);

    this.dhtClient = new dht.Client(dhtClientId);
    this.dhtClient.on('peers.discover', this.handlePeersDiscover.bind(this));
    this.dhtClient.on('receive.connect.request', this.handleReceiveConnectRequest.bind(this));
    this.dhtClient.createChannel(bootstrapId, client.createDataChannel('dht'));

    this.ppsppClient = new ppspp.Client();
    this.ppsppClient.createChannel(client.createDataChannel('ppspp'));

    client.init();
  }

  static create(connManager) {
    return connManager.bootstrap().then(({data, conn}) => {
      return new Client(
        connManager,
        hexToUint8Array(data.id),
        hexToUint8Array(data.bootstrapId),
        conn,
        data.swarmUri,
      );
    });
  }

  handlePeersDiscover(id) {
    // console.log('creating client for', ids);
    const sub = new dht.SubChannel(this.dhtClient, id);
    const client = this.connManager.createClient(sub);

    this.dhtClient.createChannel(id, client.createDataChannel('dht'));
    this.ppsppClient.createChannel(client.createDataChannel('ppspp'));

    const timeout = setTimeout(() => client.close(), 10000);

    const init = () => {
      clearTimeout(timeout);
      client.init();
    };

    this.dhtClient.send(id, 'connect.request', {channelId: sub.id}, init);
  }

  handleReceiveConnectRequest({data: {channelId, from}, callback}) {
    // if (this.dhtClient.channels.count() > 10) {
    //   return;
    // }

    // console.log('handleReceiveConnectRequest', {channelId, from, callback});
    const id = new hexToUint8Array(from);
    const client = this.connManager.createClient(new dht.SubChannel(this.dhtClient, id, channelId));

    client.on('datachannel', ({channel}) => {
      if (channel.label === 'dht') {
        this.dhtClient.createChannel(id, channel);
      } else if (channel.label === 'ppspp') {
        this.ppsppClient.createChannel(channel);
      }
    });

    callback({});
  }
}
