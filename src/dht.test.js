jest.mock('utils/createRandomId');

import {Server, ConnManager} from './loopback';
import {Client} from './client';

it('dht clients can send and receive messages', async () => {
  const indices = new Array(3).fill(0).map((_, i) => i);
  const pairs = indices.reduce((pairs, src) => pairs.concat(indices.filter(i => i !== src).map(dst => ({src, dst}))), []);

  const connManager = new ConnManager(new Server());
  const clients = await Promise.all(indices.map(() => Client.create(connManager)));
  const dhtClients = clients.map(({dhtClient}) => dhtClient);

  dhtClients.forEach(client => client.on('receive.test', ({callback}) => callback()));

  await new Promise(resolve => setTimeout(resolve, 1000))
    .then(() => Promise.all(pairs.map(({src, dst}) => new Promise(
      resolve => dhtClients[src].send(dhtClients[dst].id, 'test', {src, dst}, resolve),
    ))));
});

it('dht clients can process messages in busy clusters', async () => {
  jest.setTimeout(10000);

  const indices = new Array(20).fill(0).map((_, i) => i);
  const pairs = indices.reduce((pairs, src) => pairs.concat(indices.filter(i => i !== src).map(dst => ({src, dst}))), []);

  const server = new Server();
  const clients = await Promise.all(indices.map((_, i) => new Promise(
    resolve => setTimeout(() => resolve(Client.create(new ConnManager(server))), 50 * i)),
  ));
  const dhtClients = clients.map(({dhtClient}) => dhtClient);

  dhtClients.forEach(client => client.on('receive.test', ({callback}) => callback()));

  await new Promise(resolve => setTimeout(resolve, 1000))
    .then(() => Promise.all(pairs.map(({src, dst}) => new Promise(
      resolve => dhtClients[src].send(dhtClients[dst].id, 'test', {src, dst}, resolve),
    ))));
});

it('dht clients can respond to messages via callbacks', async () => {
  const indices = new Array(3).fill(0).map((_, i) => i);
  const pairs = indices.reduce((pairs, src) => pairs.concat(indices.filter(i => i !== src).map(dst => ({src, dst}))), []);

  const connManager = new ConnManager(new Server());
  const clients = await Promise.all(indices.map(() => Client.create(connManager)));
  const dhtClients = clients.map(({dhtClient}) => dhtClient);

  dhtClients.forEach(client => client.on('receive.test', ({data: {src, dst}, callback}) => callback({src, dst})));

  await new Promise(resolve => setTimeout(resolve, 1000))
    .then(() => Promise.all(pairs.map(({src, dst}) => new Promise(
      (resolve, reject) => dhtClients[src].send(dhtClients[dst].id, 'test', {src, dst}, (data) => {
        expect(src).toEqual(data.src);
        expect(dst).toEqual(data.dst);
        resolve();
      }),
    ))));
});
