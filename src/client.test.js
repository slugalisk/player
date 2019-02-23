import {ConnManager} from './loopback';
import {ClientManager} from './client';

it('test', () => {
  const connManager = new ConnManager();

  const clientResults = [];
  for (let i = 0; i < 10; i ++) {
    const clientManager = new ClientManager(connManager);
    clientResults.push(clientManager.createClient());
  }

  return Promise.all(clientResults);
});

