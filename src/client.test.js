import {Server, ConnManager} from './loopback';
import {ClientManager} from './client';
import {expect} from 'jest';

it('connect to server', () => {
  const server = new Server();
  const connManager = new ConnManager(server);

  const clientResults = [];
  for (let i = 0; i < 3; i ++) {
    clientResults.push(ClientManager.createClient(connManager));
  }

  return Promise.all(clientResults);
});

it('send message to dht peer', async () => {
  const indices = new Array(5).fill(0).map((_, i) => i);
  const pairs = indices.reduce((pairs, src) => pairs.concat(indices.filter(i => i !== src).map(dst => ({src, dst}))), []);

  const connManager = new ConnManager(new Server());
  const clients = await Promise.all(indices.map(() => ClientManager.createClient(connManager)));
  const dhtClients = clients.map(({dhtClient}) => dhtClient);

  dhtClients.forEach(client => client.on('receive.test', ({callback}) => callback()));

  await new Promise(resolve => setTimeout(resolve, 10))
    .then(() => Promise.all(pairs.map(({src, dst}) => Promise.race([
      new Promise(resolve => dhtClients[src].send(dhtClients[dst].id, 'test', {src, dst}, resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('callback timeout')), 1000)),
    ]))));
});

it('handle message callback', async () => {
  const indices = new Array(5).fill(0).map((_, i) => i);
  const pairs = indices.reduce((pairs, src) => pairs.concat(indices.filter(i => i !== src).map(dst => ({src, dst}))), []);

  const connManager = new ConnManager(new Server());
  const clients = await Promise.all(indices.map(() => ClientManager.createClient(connManager)));
  const dhtClients = clients.map(({dhtClient}) => dhtClient);

  dhtClients.forEach(client => client.on('receive.test', ({data: {src, dst}, callback}) => callback({src, dst})));

  await new Promise(resolve => setTimeout(resolve, 10))
    .then(() => Promise.all(pairs.map(({src, dst}) => Promise.race([
      new Promise((resolve, reject) => dhtClients[src].send(dhtClients[dst].id, 'test', {src, dst}, (data) => {
        if (src === data.src && dst === data.dst) {
          resolve();
        } else {
          reject(new Error(`recv mismatch {src: ${src}, dst: ${dst}} vs {src: ${data.src}, dst: ${data.dst}}`));
        }
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('callback timeout')), 1000)),
    ]))));
});

