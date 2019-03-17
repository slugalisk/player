import React, {useEffect, useState} from 'react';
import {Server, ConnManager} from '../loopback';
import {Client} from '../client';
import {ChunkedReadStream, ChunkedWriteStreamInjector} from '../chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';

import './App.scss';

const App = () => {
  const [server] = useState(new Server());
  const [swarms, setSwarms] = useState([]);
  const [swarmUri, setSwarmUri] = useState('');

  useEffect(() => {
    const injector = new ChunkedWriteStreamInjector();

    injector.on('publish', ({injector: {swarm}}) => {
      setSwarmUri(swarm.uri);
      server.ppsppClient.publishSwarm(swarm);
    });

    injector.on('unpublish', ({injector: {swarm}}) => {
      server.ppsppClient.unpublishSwarm(swarm);
    });

    injector.start({
      bitRate: 9000000,
    });

    return () => injector.stop();
  }, []);

  const handleAddPeerClick = () => {
    Client.create(new ConnManager(server)).then(({ppsppClient}) => {
      const swarm = ppsppClient.joinSwarm(swarmUri);
      // console.log(ppsppClient);

      setSwarms([...swarms, swarm]);

      const stream = new ChunkedReadStream(swarm);
      stream.on('data', d => console.log(`received ${d.length} bytes`));
    });
  };

  const diagnosticMenus = swarms.map((swarm, i) => (
    <DiagnosticMenu
      key={i}
      swarm={swarm}
      containerClass={`diagnostic-menu--indent-${i}`}
    />
  ));

  return (
    <div>
      {diagnosticMenus}
      <button onClick={handleAddPeerClick}>add peer</button>
    </div>
  );
};

export default App;
