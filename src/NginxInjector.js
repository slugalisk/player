import {spawn} from 'child_process';
import express from 'express';
import bodyParser from 'body-parser';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import Injector from './ppspp/injector';
import {EventEmitter} from 'events';
import {ChunkedWriteStream} from './chunkedStream';

export default class NginxInjector extends EventEmitter {
  constructor() {
    super();
    this.injectors = {};
    this.writers = {};
  }

  handleConnect(req, res) {
    console.log('handleConnect', req.body);
    res.status(200).send('');
  }

  handlePlay(req, res) {
    console.log('handlePlay', req.body);
  }

  handlePublish(req, res) {
    console.log('handlePublish', req.body);
    Injector.create().then(injector => {
      // res.status(200).send('');
      res.redirect('memes');

      this.writers[req.body.name] = new ChunkedWriteStream(injector);
      this.injectors[req.body.name] = injector;
      this.emit('publish', {
        name: req.body.name,
        contentType: 'video/mpeg-ts',
        injector,
      });
    });
  }

  handleDone(req, res) {
    console.log('handleDone', req.body);
    res.status(200).send('');
  }

  handlePublishDone(req, res) {
    console.log('handlePublishDone', req.body);
    res.status(200).send('');

    this.emit('unpublish', {
      name: req.body.name,
      injector: this.injectors[req.body.name],
    });
    delete this.injectors[req.body.name];
  }

  handleVideoChunk(filename) {
    /* eslint-disable-next-line */
    const [streamName, chunkId] = path.basename(filename, '.ts').split('-');

    fs.readFile(filename, {}, (err, data) => {
      // console.log(streamName, chunkId, err, data.length);

      const writer = this.writers[streamName];
      if (writer !== undefined) {
        writer.write(data);
      }
    });
  }

  start() {
    this.startManager();
    this.startNginx();
    this.startFileLoader();
  }

  startManager() {
    const manager = express();
    manager.use(bodyParser.urlencoded({extended: true}));

    manager.post('/api/rtmp/connect', this.handleConnect.bind(this));
    manager.post('/api/rtmp/play', this.handlePlay.bind(this));
    manager.post('/api/rtmp/publish', this.handlePublish.bind(this));
    manager.post('/api/rtmp/done', this.handleDone.bind(this));
    manager.post('/api/rtmp/publish_done', this.handlePublishDone.bind(this));

    const port = 9001;
    this.manager = manager.listen(port, () => console.log('manager started on', port));
  }

  startNginx() {
    this.nginx = spawn(path.join(__dirname, '/../vendor/nginx/objs/nginx'));

    this.nginx.stdout.on('data', (data) => {
      console.log(`ps log: ${data}`);
    });

    this.nginx.stderr.on('data', (data) => {
      console.log(`ps stderr: ${data}`);
    });
  }

  startFileLoader() {
    this.chokidar = chokidar.watch('/dev/shm/hls/*.ts', {
      ignoreInitial: true,
      followSymlinks: false,
      // awaitWriteFinish: true,

      usePolling: true,
      interval: 100,

      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.chokidar.on('add', filename => this.handleVideoChunk(filename));
  }

  stop(done) {
    if (done) {
      const nginxExit = new Promise(resolve => {
        this.nginx.on('exit', resolve);
      });
      const managerClose = new Promise(resolve => {
        this.manager.on('close', resolve);
      });

      Promise.all([nginxExit, managerClose]).then(done);
    }

    this.nginx.kill();
    this.manager.close();
    this.chokidar.close();
  }
}
