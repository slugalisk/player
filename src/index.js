import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { EventEmitter } from 'events';

import ppspp from './ppspp';
import dht from './dht';
import wrtc from './wrtc';
import hexToUint8Array from './hexToUint8Array';

import './index.css';
import './App.css';

class WebSocketBootstrap extends EventEmitter {
  constructor(address) {
    super();

    const conn = new WebSocket('ws://' + address);
    conn.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'bootstrap') {
        this.emit('bootstrap', {data, conn});
      } else {
        throw new Error(`expected bootstrap, received "${data.type}"`);
      }
    };
  }
}

// TODO: ensure some supernode connection

const address = window.location.hostname + ':8080';
const bootstrap = new WebSocketBootstrap(address);

bootstrap.on('bootstrap', ({data, conn}) => {
  console.log('bootstrap', data);

  const mediator = new wrtc.Mediator(conn);
  const client = new wrtc.Client(mediator);

  client.once('open', () => conn.close());

  const dhtClient = new dht.Client(hexToUint8Array(data.id));
  const ppsppClient = new ppspp.Client();

  const bootstrapId = hexToUint8Array(data.bootstrapId);
  dhtClient.addChannel(new dht.Channel(bootstrapId, client.createDataChannel('dht')));
  ppsppClient.addChannel(new ppspp.Channel(client.createDataChannel('ppspp')));

  client.init();

  dhtClient.on('peers', ids => ids.forEach(id => {
    const sub = new dht.SubChannel(dhtClient, id);
    const mediator = new wrtc.Mediator(sub);
    const client = new wrtc.Client(mediator);

    client.once('open', () => sub.close());

    dhtClient.addChannel(new dht.Channel(id, client.createDataChannel('dht')));
    ppsppClient.addChannel(new ppspp.Channel(client.createDataChannel('ppspp')));

    dhtClient.send(id, 'connect.request', {subChannelId: sub.id}, () => client.init());
  }));

  dhtClient.on('receive.connect.request', ({data: {subChannelId, from}, callback}) => {
    console.log('receive.connect.request', subChannelId, from);

    const id = new hexToUint8Array(from);
    const sub = new dht.SubChannel(dhtClient, id, subChannelId);
    const mediator = new wrtc.Mediator(sub);
    const client = new wrtc.Client(mediator);

    client.once('open', () => sub.close());

    client.on('datachannel', ({channel}) => {
      if (channel.label === 'dht') {
        dhtClient.addChannel(new dht.Channel(id, channel));
      } else if (channel.label === 'ppspp') {
        ppsppClient.addChannel(new ppspp.Channel(channel));
      }
    });

    callback();
  });
})

ReactDOM.render(<App />, document.getElementById('root'));
// registerServiceWorker();
