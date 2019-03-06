import {
  Conn,
  Mediator,
  Client,
} from './loopback';

it('loopback clients emit open event when initialized', () => {
  const conn = Conn.open();

  const clientA = new Client(new Mediator(conn));
  const clientB = new Client(new Mediator(conn.remote));

  clientA.init();

  return Promise.all([
    new Promise(resolve => clientA.on('open', resolve)),
    new Promise(resolve => clientB.on('open', resolve)),
  ]);
});

it('loopback clients can send and receive messages', () => {
  const conn = Conn.open();

  const clientA = new Client(new Mediator(conn));
  const clientB = new Client(new Mediator(conn.remote));

  let channelB;
  clientB.on('datachannel', ({channel}) => channelB = channel);
  const channelA = clientA.createDataChannel('test');

  clientA.init();

  const fromBToA = new Promise(resolve => {
    clientB.on('open', () => channelB.send('from b to a'));

    channelA.on('message', ({data}) => {
      expect(data).toEqual('from b to a');
      resolve();
    });
  });

  const fromAToB = new Promise(resolve => {
    clientA.on('open', () => channelA.send('from a to b'));

    clientB.on('datachannel', ({channel}) => {
      channel.on('message', ({data}) => {
        expect(data).toEqual('from a to b');
        resolve();
      });
    });
  });

  return Promise.all([fromBToA, fromAToB]);
});
