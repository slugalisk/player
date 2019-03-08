require('dotenv').config();

import URI from './ppspp/uri';
import {Client} from './client';
import {ConnManager} from './wrtc';
import arrayBufferToHex from 'array-buffer-to-hex';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const screen = blessed.screen();

const table = contrib.table({
  keys: true,
  fg: 'white',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: true,
  label: 'Active Processes',
  width: '30%',
  height: '30%',
  border: {
    type: "line",
    fg: "cyan",
  },
  columnSpacing: 10, //in chars
  columnWidth: [32, 32], /*in chars*/
});
screen.append(table);

// console.log('bootstrap address', process.env.BOOTSTRAP_ADDRESS);
const connManager = new ConnManager(process.env.BOOTSTRAP_ADDRESS);
Client.create(connManager).then(({
  ppsppClient,
  dhtClient,
  swarmUri,
}) => {
  // console.log('joining', swarmUri);

  setTimeout(() => ppsppClient.joinSwarm(URI.parse(swarmUri)), 5000);

  let nodes = [];
  let links = [];

  const update = () => {
    // console.log({nodes, links});
    table.setData({
      headers: ['source', 'target'],
      data: links.map(({source, target}) => [source, target]),
    });
    screen.render();
  };

  const {id, allChannels} = dhtClient;

  const source = arrayBufferToHex(id);
  nodes.push({
    id: source,
    dhtClient,
  });

  allChannels.toArray().forEach(channel => {
    if (channel.isOpen()) {
      links.push({
        source,
        target: arrayBufferToHex(channel.id),
      });
      update();
    }
  });

  allChannels.on('added',  channel => {
    if (channel.isOpen()) {
      links.push({
        source,
        target: arrayBufferToHex(channel.id),
      });
      update();
    }
  });
  allChannels.on('updated', (oldChannel, newChannel) => {
    if (oldChannel.isOpen() !== newChannel.isOpen()) {
      links.push({
        source,
        target: arrayBufferToHex(newChannel.id),
      });
      update();
    }
  });
  allChannels.on('removed', ({id}) => {
    const target = arrayBufferToHex(id);
    const i = links.findIndex(link => {
      return link.source === source || link.target === target;
    });
    if (i !== -1) {
      links.splice(i, 1);
      update();
    }
  });

  update();
});

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

screen.render();
