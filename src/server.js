require('dotenv').config();

import http from 'http';
import https from 'https';
import express from 'express';
import fs from 'fs';
import ws from 'ws';
import hilbert from 'hilbert';
import ip2location from 'ip2location-nodejs';
import crypto from 'crypto';
import arrayBufferToHex from 'array-buffer-to-hex';
import NginxInjector from './NginxInjector';
import {ChunkedWriteStreamInjector} from './chunkedStream';
import compression from 'compression';
import * as dht from './dht';
import * as ppspp from './ppspp';
import * as wrtc from './wrtc';
import * as pubsub from './pubsub';

const args = require('minimist')(process.argv.slice(2));
const port = args.p || process.env.PORT || 8080;

const swarms = [];

const app = express();
app.use(compression());
app.use(express.static(process.env.STATIC_PATH || 'public'));

const createHttpsServer = app => https.createServer({
  key: fs.readFileSync(process.env.HTTPS_KEY_PATH),
  cert: fs.readFileSync(process.env.HTTPS_CERT_PATH),
}, app);

let server = process.env.HTTPS_ENABLE === 'true'
  ? createHttpsServer(app)
  : http.createServer(app);

server.listen(port, function(err) {
  const address = server.address();
  console.log('Server running at ' + address.port);
});

const generateRandomId = () => {
  const id = Buffer.alloc(16);
  crypto.randomFillSync(id);

  return new Uint8Array(id);
};

const generateIdFromGeo = addr => {
  const location = ip2location.IP2Location_get_all(addr);
  const prefix = (new hilbert.Hilbert2d(1)).xy2d(
    Math.round(((parseFloat(location.longitude) || 0) + 180) * 100),
    Math.round(((parseFloat(location.latitude) || 0) + 90) * 100)
  );

  const id = Buffer.alloc(16);
  id.writeUInt32BE(prefix);
  crypto.randomFillSync(id, 4);

  return new Uint8Array(id);
};

let generateId = generateRandomId;
if (process.env.GEOIP_DB_PATH) {
  ip2location.IP2Location_init(process.env.GEOIP_DB_PATH);
  generateId = generateIdFromGeo;
}

const serverIp = process.env.EXTERNAL_IP || server.address().address;
const dhtClient = new dht.Client(generateId(serverIp));
const ppsppClient = new ppspp.Client();

const wss = new ws.Server({server});
wss.on('connection', function(conn, req) {
  const mediator = new wrtc.Mediator(conn);
  const client = new wrtc.Client(mediator);
  const id = generateId(req.headers[process.env.IP_HEADER] || req.connection.remoteAddress);

  mediator.on('error', () => conn.close());

  client.on('datachannel', ({channel}) => {
    if (channel.label === 'dht') {
      dhtClient.createChannel(id, channel);
    } else if (channel.label === 'ppspp') {
      ppsppClient.createChannel(channel);
    }
  });

  conn.send(JSON.stringify({
    type: 'bootstrap',
    bootstrapId: arrayBufferToHex(dhtClient.id),
    id: arrayBufferToHex(id),
    swarms,
  }));
});

const registerInjector = factory => {
  factory.on('publish', ({name, contentType, injector: {swarm}}) => {
    ppsppClient.publishSwarm(swarm);

    const uri = swarm.uri.toString();
    swarms.push({name, contentType, uri});
    indexInjector.publish({type: 'PUBLISH_SWARM', name, contentType, uri});
  });

  factory.on('unpublish', ({name, injector: {swarm}}) => {
    const index = swarms.findIndex(entry => entry.swarm === swarm);
    if (index !== -1) {
      ppsppClient.unpublishSwarm(swarm);

      swarms.splice(index, 1);
      indexInjector.publish({
        type: 'UNPUBLISH_SWARM',
        name,
        uri: swarm.uri.toString(),
      });
    }
  });
};

const nginxInjector = new NginxInjector({
  chunkSize: 32 * 1024,
  chunksPerSignature: 16,
});
const noiseInjector = new ChunkedWriteStreamInjector();
const pubSubInjector = new pubsub.Injector();

registerInjector(nginxInjector);
registerInjector(noiseInjector);
registerInjector(pubSubInjector);

const indexInjector = pubSubInjector.createTopic('index');

const heartbeatInjector = pubSubInjector.createTopic('heartbeat');
let heartbeatSequence = 0;
setInterval(() => heartbeatInjector.publish({
  type: 'HEARTBEAT',
  time: new Date(),
  sequence: heartbeatSequence ++,
}), 500);

const chatInjector = pubSubInjector.createTopic('chat');
let chatSequence = 0;
dhtClient.on('receive.chat.message', ({data}) => {
  console.log(data);
  chatInjector.publish({
    type: 'MESSAGE',
    time: new Date(),
    id: chatSequence ++,
    message: data.message,
  });
});

nginxInjector.start();

// noiseInjector.start({name: 'noise', bitRate: 3500000});
noiseInjector.start({
  name: 'noise',
  bitRate: 9000000,
  chunkSize: 32 * 1024,
  chunksPerSignature: 16,
});

const shutdown = (signal = 'SIGTERM') => {
  const close = (close, message) => new Promise(resolve => close(resolve)).then(() => console.log(message));

  Promise.all([
    close(nginxInjector.stop.bind(nginxInjector), 'nginx injector shut down'),
    close(server.close.bind(server), 'server shut down'),
    close(wss.close.bind(wss), 'wss shut down'),
  ]).then(() => process.kill(process.pid, signal));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGUSR2', shutdown);

process.on('uncaughtException', (err) => {
  shutdown();
  throw err;
});
