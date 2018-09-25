const {spawn} = require('child_process');
const express = require('express');
const bodyParser = require('body-parser');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const Injector = require('./ppspp/injector');
const {EventEmitter} = require('events');

class NginxInjector extends EventEmitter {
  constructor() {
    super();
    this.injectors = {};
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

      this.injectors[req.body.name] = injector;
      this.emit('publish', injector);
    });
  }

  handleDone(req, res) {
    console.log('handleDone', req.body);
    res.status(200).send('');
  }

  handlePublishDone(req, res) {
    console.log('handlePublishDone', req.body);
    res.status(200).send('');

    this.emit('unpublish', this.injectors[req.body.name]);
    delete this.injectors[req.body.name];
  }

  handleVideoChunk(filename) {
    const [streamName, chunkId] = path.basename(filename, '.ts').split('-');

    fs.readFile(filename, {}, (err, data) => {
      console.log(streamName, chunkId, err, data.length);

      if (this.injectors[streamName] !== undefined) {
        this.injectors[streamName].appendChunk(data);
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

module.exports = NginxInjector;
