import PpsppInjector from './ppspp/injector';
import {EventEmitter} from 'events';
import {ChunkedWriteStream, ChunkedReadStream} from './chunkedStream';
import debounce from 'lodash.debounce';

export class Topic {
  constructor(
    injectorResult,
    {
      minFlushIvl = 20,
      maxFlushIvl = 200,
    } = {},
  ) {
    this.injectorResult = injectorResult;
    this.minFlushIvl = minFlushIvl;
    this.maxFlushIvl = maxFlushIvl;

    this.lastFlushTime = 0;
    this.flushTimeout = null;

    this.writerResult = injectorResult.then(injector => new ChunkedWriteStream(injector));

    this.flush = debounce(
      () => injectorResult.then(injector => injector.flush()),
      minFlushIvl,
      {maxWait: maxFlushIvl},
    );
  }

  publish(event) {
    const json = Buffer.from(JSON.stringify(event), 'utf8');
    this.writerResult.then(writer => writer.write(json));
    this.flush();
  }
}

export class Injector extends EventEmitter {
  constructor() {
    super();
    this.topics = {};
  }

  handleConnect(req, res) {
    console.log('handleConnect', req.body);
    res.status(200).send('');
  }

  handlePlay(req, res) {
    console.log('handlePlay', req.body);
  }

  createTopic(name) {
    if (this.topics[name] !== undefined) {
      throw new Error('topic already exists');
    }
    console.log('creating topic', name);

    const injectorResult = PpsppInjector.create({
      chunkSize: 256,
      chunksPerSignature: 1,
    });

    injectorResult.then(injector => this.emit('publish', {
      name,
      contentType: 'application/json',
      injector,
    }));

    return this.topics[name] = new Topic(injectorResult);
  }

  destroyTopic(name) {
    const topic = this.topics[name];
    if (topic === undefined) {
      throw new Error('topic does not exists');
    }
    console.log('destroying topic', name);

    this.emit('unpublish', {name, injector: topic.injector});
    delete this.topics[name];
  }
}

export class PubSubConsumer extends EventEmitter {
  constructor(swarm) {
    super();

    const stream = new ChunkedReadStream(swarm);
    stream.on('data', this.handleData.bind(this));
  }

  handleData({chunks}) {
    const data = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    this.emit('message', JSON.parse(data));
  }
}
