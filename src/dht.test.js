import {Client, Channel, SubChannel} from './dht';
import { EventEmitter } from 'events';
const createRandomId = require('./utils/createRandomId');

it('handle replacing peers', () => {
  const client = new Client(createRandomId());

  for (let i = 0; i < 100; i ++) {
    const conn = new EventEmitter();
    conn.addEventListener = (...args) => conn.on(...args);
    conn.removeEventListener = (...args) => conn.removeListener(...args);
    conn.send = () => {};

    client.createChannel(createRandomId(), conn);

    conn.emit('open');
  }
});
