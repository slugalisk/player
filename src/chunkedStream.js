import {EventEmitter} from 'events';
import Injector from './ppspp/injector';

const DELIMITER = Buffer.from('4c93bf00ae13c37e5df3b7a9cea0413521fe1b08a627d065d7180b9d0738c666', 'hex');
const DELIMITER_LENGTH = DELIMITER.length;
const HEADER_INSTANCE_LENGTH = 37;

export class ChunkedWriteStream extends EventEmitter {
  constructor(injector) {
    super();
    this.injector = injector;
  }

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

  flush() {
    this.injector.flush();
  }
}

export class ChunkedWriteStreamInjector extends EventEmitter {
  start({
    name = 'chunked-stream',
    bitRate = 3500000,
    ...injectorOptions
  } = {}) {
    this.name = name;

    const data = Buffer.alloc(bitRate / 8);
    data.fill(255);

    Injector.create(injectorOptions).then(injector => {
      this.injector = injector;

      const writer = new ChunkedWriteStream(injector);
      this.intervalId = setInterval(() => writer.write(data), 1000);
      this.emit('publish', {
        name,
        contentType: 'application/octet-stream',
        injector,
      });
    });
  }

  stop(done) {
    clearInterval(this.intervalId);
    this.emit('unpublish', {name: this.name, injector: this.injector});
    if (done) {
      setTimeout(done);
    }
  }
}

class AbstractChunkedReadStream extends EventEmitter {
  constructor(swarm) {
    super();

    this.swarm = swarm;

    this.handleWarmupSwarmData = this.handleWarmupSwarmData.bind(this);
    this.handleSwarmData = this.handleSwarmData.bind(this);

    this.chunkBufferLength = 0;
    this.nextDataOffset = 0;
    this.nextDataLength = 0;

    this.swarm.on('data', this.handleWarmupSwarmData);
  }

  handleWarmupSwarmData(data, offset = 0) {
    let nextChunkOffset = offset;

    for (let i = 0; i < data.length; i ++) {
      const delimiterIndex = data[i].indexOf(DELIMITER, nextChunkOffset);
      nextChunkOffset = 0;
      if (delimiterIndex === -1 || delimiterIndex + HEADER_INSTANCE_LENGTH > data[i].length) {
        continue;
      }

      this.swarm.removeListener('data', this.handleWarmupSwarmData);
      this.swarm.on('data', this.handleSwarmData);

      this.readHeader(data[i], delimiterIndex);
      this.handleSwarmData(data.slice(i));

      break;
    }
  }

  readHeader(data, offset) {
    const instance = data.readUInt8(offset + DELIMITER_LENGTH);
    this.nextDataOffset = offset + HEADER_INSTANCE_LENGTH * (2 - instance);
    this.nextDataLength = data.readUInt32BE(offset + DELIMITER_LENGTH + 1);
  }

  handleSwarmData(data) {
    for (let i = 0; i < data.length; i ++) {
      const lastChunkOffset = this.chunkBufferLength;

      this.chunkBufferLength += data[i].length;

      const nextDataEnd = this.nextDataOffset + this.nextDataLength;
      if (this.chunkBufferLength < nextDataEnd) {
        this.handleData(data[i], lastChunkOffset);
        continue;
      }

      const lastChunkEnd = nextDataEnd - lastChunkOffset;
      this.handleEndData(data[i], lastChunkEnd);

      // find the next header or defer to handleWarmupSwarmData if it hasn't arrived
      if (this.chunkBufferLength - nextDataEnd <= HEADER_INSTANCE_LENGTH) {
        this.swarm.removeListener('data', this.handleSwarmData);
        this.swarm.on('data', this.handleWarmupSwarmData);

        this.chunkBufferLength = 0;
        this.handleWarmupSwarmData(data.slice(i), lastChunkEnd);
        return;
      }

      this.chunkBufferLength = 0;
      this.readHeader(data[i], lastChunkEnd);
      i--;
    }
  }
}

export class ChunkedFragmentedReadStream extends AbstractChunkedReadStream {
  constructor(swarm) {
    super(swarm);

    this.firstEmitted = false;
  }

  handleData(data, lastChunkOffset) {
    if (!this.firstEmitted) {
      if (this.chunkBufferLength > this.nextDataOffset) {
        this.emit('start', data.slice(this.nextDataOffset - lastChunkOffset));
        this.firstEmitted = true;
      }

      return;
    }

    this.emit('data', data);
  }

  handleEndData(data, lastChunkEnd) {
    this.emit('end', data.slice(0, lastChunkEnd));
    this.firstEmitted = false;
  }
}

export class ChunkedReadStream extends AbstractChunkedReadStream {
  constructor(swarm) {
    super(swarm);

    this.chunkBuffer = [];
  }

  handleData(data) {
    this.chunkBuffer.push(data);
  }

  handleEndData(data, lastChunkEnd) {
    this.chunkBuffer.push(data);

    // trim export data range and emit
    const chunkSlice = this.chunkBuffer.slice();

    chunkSlice[chunkSlice.length - 1] = chunkSlice[chunkSlice.length - 1].slice(0, lastChunkEnd);

    let firstChunkStart = this.nextDataOffset;
    if (firstChunkStart >= chunkSlice[0].length) {
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
  }
}
