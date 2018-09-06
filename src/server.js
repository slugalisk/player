const http = require('http');
const express = require('express');
const ws = require('ws');
const hilbert = require('hilbert');
const ip2location = require('ip2location-nodejs');
const path = require('path');
const crypto = require('crypto');
const arrayBufferToHex = require('array-buffer-to-hex');
const dht = require('./dht');
const ppspp = require('./ppspp');
const wrtc = require('./wrtc');
const dotenv = require('dotenv');

dotenv.config();
ip2location.IP2Location_init(path.join(__dirname, 'IP2LOCATION-LITE-DB5.BIN'));

const args = require('minimist')(process.argv.slice(2));
const port = args.p || 8080;

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);

server.listen(port, function() {
  const address = server.address();
  console.log('Server running at ' + address.port);
});

const serverIp = process.env.EXTERNAL_IP || server.address().address;
const dhtClient = new dht.Client(generateId(serverIp));
const ppsppClient = new ppspp.Client();

const wss = new ws.Server({server});
wss.on('connection', function(ws, req) {
  const mediator = new wrtc.Mediator(ws);
  const client = new wrtc.Client(mediator);
  const id = generateId(req.connection.remoteAddress);

  client.on('datachannel', ({channel}) => {
    if (channel.label === 'dht') {
      dhtClient.addChannel(new dht.Channel(id, channel));
    } else if (channel.label === 'ppspp') {
      ppsppClient.addChannel(new ppspp.Channel(channel));
    }
  });

  ws.send(JSON.stringify({
    type: 'bootstrap',
    bootstrapId: arrayBufferToHex(dhtClient.id),
    id: arrayBufferToHex(id),
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
