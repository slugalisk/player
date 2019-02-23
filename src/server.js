require('dotenv').config();

const http = require('http');
const express = require('express');
const ws = require('ws');
const hilbert = require('hilbert');
const ip2location = require('ip2location-nodejs');
const path = require('path');
const crypto = require('crypto');
const arrayBufferToHex = require('array-buffer-to-hex');
const NginxInjector = require('./NginxInjector');
// const {ChunkedWriteStreamInjector} = require('./chunkedStream');
const dht = require('./dht');
const ppspp = require('./ppspp');
const wrtc = require('./wrtc');

ip2location.IP2Location_init(path.join(__dirname, '../vendor/IP2LOCATION-LITE-DB5.BIN'));

const args = require('minimist')(process.argv.slice(2));
const port = args.p || 8080;

let swarmUri = '';

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);

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

