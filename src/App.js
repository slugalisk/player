import React, {useEffect, useState} from 'react';
import URI from './ppspp/uri';
import SwarmPlayer from './SwarmPlayer';
import {ConnManager, ClientManager} from './client';
// import {ChunkedReadStream} from './chunkedStream';

import './App.css';

const BOOTSTRAP_ADDRESS = process.env.NODE_ENV === 'development'
  ? window.location.hostname + ':8080'
  : window.location.host;

const App = () => {
  const [ppsppClient, setPpsppClient] = useState(null);
  const [swarmUri, setSwarmUri] = useState('');
  const [swarm, setSwarm] = useState(null);

  useEffect(() => {
    const connManager = new ConnManager(BOOTSTRAP_ADDRESS);
    const clientManager = new ClientManager(connManager);

    clientManager.createClient().then(({ppsppClient, swarmUri}) => {
      setPpsppClient(ppsppClient);
      setSwarmUri(swarmUri);
    });
  }, []);

  if (swarm) {
    return <SwarmPlayer swarm={swarm} />;
  }

  const onJoinSubmit = e => {
    e.preventDefault();

    console.log(swarmUri);
    const uri = URI.parse(swarmUri);
    console.log('joining', uri);

    const swarm = ppsppClient.joinSwarm(uri);
    // const stream = new ChunkedReadStream(swarm);
    // stream.on('data', d => console.log(`received ${d.length} bytes`));
    setSwarm(swarm);
  };

  const onInputChange = e => {
    setSwarmUri(e.target.value);
  };

  return (
    <React.Fragment>
      <div className="idle">
        <div className="scanner"></div>
        <div className="noise"></div>
      </div>
      <form className="join-form" onSubmit={onJoinSubmit}>
        <input
          onChange={onInputChange}
          placeholder="Enter Swarm URI"
          defaultValue={swarmUri}
        />
        <button>Join</button>
      </form>
    </React.Fragment>
  );
};

export default App;
