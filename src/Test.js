import React, {useEffect, useState} from 'react';
import {Server, ConnManager} from './loopback';
import {ClientManager} from './client';
import {ChunkedReadStream, ChunkedWriteStreamInjector} from './chunkedStream';

import './App.css';

const App = () => {
  const [server] = useState(new Server());
  const [swarmUri, setSwarmUri] = useState('');

  useEffect(() => {
    const injector = new ChunkedWriteStreamInjector();

    injector.on('publish', ({swarm}) => {
      setSwarmUri(swarm.uri);
      server.ppsppClient.publishSwarm(swarm);
    });

    injector.on('unpublish', ({swarm}) => {
      server.ppsppClient.unpublishSwarm(swarm);
    });

    injector.start();

    return () => injector.stop();
  }, []);

  const onAddPeerClick = () => {
    const clientManager = new ClientManager(new ConnManager(server));

    clientManager.createClient().then(({ppsppClient}) => {
      const swarm = ppsppClient.joinSwarm(swarmUri);
      console.log(swarm);
      const stream = new ChunkedReadStream(swarm);
      stream.on('data', d => console.log(`received ${d.length} bytes`));
    });
  };

  return (
    <div>
      <button onClick={onAddPeerClick}>add peer</button>
    </div>
  );
};

export default App;
