require('dotenv').config();

import https from 'https';
import express from 'express';
import fs from 'fs';
import ws from 'ws';
import hilbert from 'hilbert';
import ip2location from 'ip2location-nodejs';
import path from 'path';
import crypto from 'crypto';
import arrayBufferToHex from 'array-buffer-to-hex';
import NginxInjector from './NginxInjector';
// import {ChunkedWriteStreamInjector} from './chunkedStream';
import * as dht from './dht';
import * as ppspp from './ppspp';
import * as wrtc from './wrtc';

ip2location.IP2Location_init(path.join(__dirname, '..', 'vendor', 'IP2LOCATION-LITE-DB5.BIN'));

const args = require('minimist')(process.argv.slice(2));
const port = args.p || 8080;

let swarmUri = '';

const app = express();
app.use(express.static('public'));

const server = https.createServer({
  key: fs.readFileSync(path.join(__dirname, '..', 'tls', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, '..', 'tls', 'certificate.pem')),
}, app);

server.listen(port, function(err) {
  const address = server.address();
  console.log('Server running at ' + address.port);
});

const serverIp = process.env.EXTERNAL_IP || server.address().address;
const dhtClient = new dht.Client(generateId(serverIp));
const ppsppClient = new ppspp.Client();

const wss = new ws.Server({server});
wss.on('connection', function(conn, req) {
  const mediator = new wrtc.Mediator(conn);
  const client = new wrtc.Client(mediator);
  const id = generateId(req.connection.remoteAddress);

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
    swarmUri,
  }));
});

function generateId(addr) {
  const location = ip2location.IP2Location_get_all(addr);
  const prefix = (new hilbert.Hilbert2d(1)).xy2d(
    Math.round(((parseFloat(location.longitude) || 0) + 180) * 100),
    Math.round(((parseFloat(location.latitude) || 0) + 90) * 100)
  );

  const id = Buffer.alloc(16);
  id.writeUInt32BE(prefix);
  crypto.randomFillSync(id, 4);

  return new Uint8Array(id);
}

const injector = new NginxInjector();
// const injector = new ChunkedWriteStreamInjector();
injector.start();

injector.on('publish', ({swarm}) => {
  swarmUri = swarm.uri.toString();
  ppsppClient.publishSwarm(swarm);
});

injector.on('unpublish', ({swarm}) => {
  ppsppClient.unpublishSwarm(swarm);
});

const shutdown = (signal = 'SIGTERM') => {
  console.log(`got signal ${signal}`);
  injector.stop(() => {
    console.log('injector shut down');
    server.close(() => {
      console.log('server shut down');
      wss.close(() => {
        console.log('wss shut down');
        process.kill(process.pid, signal);
        // process.exit(signal);
      });
    });
  });
};

process.once('SIGINT', shutdown);
process.once('SIGUSR2', shutdown);

process.on('uncaughtException', (err) => {
  injector.stop();
  server.close();
  throw err;
});

