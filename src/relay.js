require('dotenv').config();

import URI from './ppspp/uri';
import {Client} from './client';
import {ConnManager} from './wrtc';

console.log('bootstrap address', process.env.BOOTSTRAP_ADDRESS);
const connManager = new ConnManager(process.env.BOOTSTRAP_ADDRESS);
Client.create(connManager).then(({ppsppClient, swarmUri}) => {
  console.log('joining', swarmUri);

  setTimeout(() => ppsppClient.joinSwarm(URI.parse(swarmUri)), 5000);
});
