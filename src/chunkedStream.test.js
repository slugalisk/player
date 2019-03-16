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

const runCopyTest = (expectedCount, chunkSize, relayChunkSize) => {
  const relay = new Relay(relayChunkSize);

  const writeStream = new chunkedStream.ChunkedWriteStream();
  writeStream.injector = relay;

  const readStream = new chunkedStream.ChunkedReadStream(relay);

  let dataCount = 0;
  let dataLength = 0;

  readStream.on('data', data => {
    const expectedData = Buffer.alloc(chunkSize);
    expectedData.fill(dataCount);

    expect(Buffer.concat(data.chunks)).toEqual(expectedData);

    dataCount ++;
    dataLength += data.length;
  });

  const data = Buffer.alloc(chunkSize);
  for (let i = 0; i < expectedCount; i ++) {
    data.fill(i);
    writeStream.write(data);
  }
  relay.flush();

  expect(dataCount).toEqual(expectedCount);
  expect(dataLength).toEqual(chunkSize * expectedCount);
};

it('can copy data with multiple chunks per message', () => runCopyTest(10, 2048, 128));

it('can copy data with multiple messages per chunk', () => runCopyTest(10, 128, 2048));
