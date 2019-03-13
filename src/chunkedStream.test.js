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

it ('does this one thing', () => {
  const reader = Object.create(chunkedStream.ChunkedReadStream.prototype);
  reader.chunkBuffer = [];
  reader.chunkBufferLength = 256;
  reader.nexDataLength = 34;
  reader.nextDataOffset = 222;

  reader.on('data', data => {
    console.log(Buffer.concat(data.chunks).toString());
  });

  const data = Uint8Array.from([102, 1, 0, 0, 0, 34, 123, 34, 116, 121, 112, 101, 34, 58, 34, 72, 69, 65, 82, 84, 66, 69, 65, 84, 34, 44, 34, 115, 101, 113, 117, 101, 110, 99, 101, 34, 58, 52, 50, 125, 76, 147, 191, 0, 174, 19, 195, 126, 93, 243, 183, 169, 206, 160, 65, 53, 33, 254, 27, 8, 166, 39, 208, 101, 215, 24, 11, 157, 7, 56, 198, 102, 0, 0, 0, 0, 34, 76, 147, 191, 0, 174, 19, 195, 126, 93, 243, 183, 169, 206, 160, 65, 53, 33, 254, 27, 8, 166, 39, 208, 101, 215, 24, 11, 157, 7, 56, 198, 102, 1, 0, 0, 0, 34, 123, 34, 116, 121, 112, 101, 34, 58, 34, 72, 69, 65, 82, 84, 66, 69, 65, 84, 34, 44, 34, 115, 101, 113, 117, 101, 110, 99, 101, 34, 58, 52, 51, 125, 76, 147, 191, 0, 174, 19, 195, 126, 93, 243, 183, 169, 206, 160, 65, 53, 33, 254, 27, 8, 166, 39, 208, 101, 215, 24, 11, 157, 7, 56, 198, 102, 0, 0, 0, 0, 34, 76, 147, 191, 0, 174, 19, 195, 126, 93, 243, 183, 169, 206, 160, 65, 53, 33, 254, 27, 8, 166, 39, 208, 101, 215, 24, 11, 157, 7, 56, 198, 102, 1, 0, 0, 0, 34, 76, 147, 191, 0, 174, 19, 195, 126, 93, 243, 183, 169, 206, 160, 65, 53, 33, 254, 27, 8, 166, 39, 208, 101, 215, 24, 11, 157, 7, 56, 198, 102, 0, 0]);
  const lastChunkEnd = 256;

  reader.handleEndData(data, lastChunkEnd);
});
