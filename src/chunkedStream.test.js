import * as chunkedStream from './chunkedStream';
import EventEmitter from 'events';

class Relay extends EventEmitter {
  constructor(chunkSize = 128) {
    super();
    this.chunkSize = chunkSize;
    this.buffer = Buffer.alloc(0);
  }

  appendData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    const chunks = [];
    while (this.buffer.length >= this.chunkSize) {
      chunks.push(this.buffer.slice(0, this.chunkSize));
      this.buffer = this.buffer.slice(this.chunkSize);
    }

    this.emit('data', chunks);
  }

  flush() {
    this.emit('data', [this.buffer]);
    this.buffer = Buffer.alloc(0);
  }
}

it('e2e', () => {
  const relay = new Relay();

  const writeStream = new chunkedStream.ChunkedWriteStream();
  writeStream.injector = relay;

  const readStream = new chunkedStream.ChunkedReadStream(relay);

  let dataLength = 0;
  readStream.on('data', data => dataLength += data.length);

  const data = Buffer.alloc(1024);
  for (let i = 0; i < 10; i ++) {
    data.fill(i);
    writeStream.write(data);
  }
  relay.flush();

  expect(dataLength).toEqual(1024 * 10);
});
