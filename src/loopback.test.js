import {
  Conn,
  Mediator,
  Client,
} from './loopback';

it('loopback clients emit open event when initialized', () => {
  const conn = new Conn();

  const clientA = new Client(new Mediator(conn));
  const clientB = new Client(new Mediator(conn.remote));

  clientA.init();

  return Promise.all([
    new Promise(resolve => clientA.on('open', () => resolve())),
    new Promise(resolve => clientB.on('open', () => resolve())),
  ]);
});

it('loopback clients can send and receive messages', () => {
  const conn = new Conn();

  const clientA = new Client(new Mediator(conn));
  const clientB = new Client(new Mediator(conn.remote));

  let channelB;
  clientB.on('datachannel', ({channel}) => channelB = channel);
  const channelA = clientA.createDataChannel('test');

  clientA.init();

  const fromBToA = new Promise(resolve => {
    clientB.on('open', () => channelB.send('abcd'));

    channelA.on('message', ({data}) => {
      expect(data).toEqual('abcd');
      resolve();
    });
  });

  const fromAToB = new Promise(resolve => {
    clientA.on('open', () => {
      channelA.send('abcd');
    });

    clientB.on('datachannel', ({channel}) => {
      channel.on('message', ({data}) => {
        expect(data).toEqual('abcd');
        resolve();
      });
    });
  });

  return Promise.all([fromBToA, fromAToB]);
});
