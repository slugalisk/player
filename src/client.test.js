jest.mock('utils/createRandomId');

import {Server, ConnManager} from './loopback';
import {Client} from './client';

it('loopback clients can connect to loopback server', () => {
  const server = new Server();
  const connManager = new ConnManager(server);

  const clientResults = [];
  for (let i = 0; i < 10; i ++) {
    clientResults.push(Client.create(connManager));
  }

  return Promise.all(clientResults);
});
