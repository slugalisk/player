const {EventEmitter} = require('events');
// const Injector = require('./ppspp/injector');

const DELIMITER = Buffer.from('4c93bf00ae13c37e5df3b7a9cea0413521fe1b08a627d065d7180b9d0738c666', 'hex');
const DELIMITER_LENGTH = DELIMITER.length;
const HEADER_INSTANCE_LENGTH = 37;

class ChunkedWriteStream extends EventEmitter {
  constructor(injector) {
    super();
    this.injector = injector;
  }

  // start() {
  //   const data = Buffer.alloc((3500000 / 8) * (250 / 1000));
  //   data.fill(255);

  //   Injector.create().then(injector => {
  //     this.intervalId = setInterval(() => this.write(data), 250);
  //     this.injector = injector;
  //     this.emit('publish', injector);
  //   });
  // }

  // stop(done) {
  //   clearInterval(this.intervalId);
  //   this.emit('unpublish', this.injector);
  //   if (done) {
  //     setTimeout(done);
  //   }
  // }

  write(buffer) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(buffer.length);
    this.injector.appendData(Buffer.concat(
      [
        DELIMITER,
        Buffer.from([0]),
        length,
        DELIMITER,
        Buffer.from([1]),
        length,
      ],
      HEADER_INSTANCE_LENGTH * 2,
    ));

    this.injector.appendData(buffer);
  }
}

class ChunkedReadStream extends EventEmitter {
  constructor(swarm) {
    super();

    this.swarm = swarm;

    this.handleWarmupData = this.handleWarmupData.bind(this);
    this.handleData = this.handleData.bind(this);

    // TODO: abstract chunk slice handling to rope
    this.chunkBuffer = [];
    this.chunkBufferLength = 0;
    this.nextDataOffset = 0;
    this.nextDataLength = 0;

    this.swarm.on('data', this.handleWarmupData);
  }

  handleWarmupData(data) {
    for (let i = 0; i < data.length; i ++) {
      const delimiterIndex = data[i].indexOf(DELIMITER);
      if (delimiterIndex === -1 || delimiterIndex + HEADER_INSTANCE_LENGTH > data[i].length) {
        continue;
      }

      this.swarm.removeListener('data', this.handleWarmupData);
      this.swarm.on('data', this.handleData);

      this.readHeader(data[i], delimiterIndex);
      this.handleData(data.slice(i));

      break;
    }
  }

  readHeader(data, offset) {
    const instance = data.readUInt8(offset + DELIMITER_LENGTH);
    this.nextDataOffset = offset + HEADER_INSTANCE_LENGTH * (2 - instance);
    this.nextDataLength = data.readUInt32BE(offset + DELIMITER_LENGTH + 1);
  }

  handleData(data) {
    for (let i = 0; i < data.length; i ++) {
      const lastChunkOffset = this.chunkBufferLength;

      this.chunkBuffer.push(data[i]);
      this.chunkBufferLength += data[i].length;

      const nextDataEnd = this.nextDataOffset + this.nextDataLength;
      if (this.chunkBufferLength < nextDataEnd) {
        continue;
      }

      // trim export data range and emit
      const chunkSlice = this.chunkBuffer.slice();

      const lastChunkEnd = nextDataEnd - lastChunkOffset;
      chunkSlice[chunkSlice.length - 1] = chunkSlice[chunkSlice.length - 1].slice(0, lastChunkEnd);

      let firstChunkStart = this.nextDataOffset;
      if (firstChunkStart > chunkSlice[0].length) {
        firstChunkStart -= chunkSlice[0].length;
        chunkSlice.shift();
      }
      chunkSlice[0] = chunkSlice[0].slice(firstChunkStart);

      this.emit(
        'data',
        {
          chunks: chunkSlice,
          length: this.nextDataLength,
        },
      );

      this.chunkBuffer = [];
      this.chunkBufferLength = 0;

      // find the next header or defer to handleWarmupData if it hasn't arrived
      if (this.chunkBufferLength - nextDataEnd <= HEADER_INSTANCE_LENGTH) {
        this.swarm.removeListener('data', this.handleData);
        this.swarm.on('data', this.handleWarmupData);

        this.handleWarmupData(data.slice(i));
        return;
      }

      this.readHeader(data[i], lastChunkEnd);
      i--;
    }
  }
}

module.exports = {
  ChunkedWriteStream,
  ChunkedReadStream,
};
