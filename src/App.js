import React, {useEffect, useState} from 'react';
import URI from './ppspp/uri';
// import DiagnosticMenu from './DiagnosticMenu';
import SwarmPlayer from './SwarmPlayer';
import {Client} from './client';
import {ConnManager} from './wrtc';
// import {ChunkedReadStream} from './chunkedStream';

import './App.css';

const App = () => {
  const [ppsppClient, setPpsppClient] = useState(null);
  const [swarmUri, setSwarmUri] = useState('');
  const [swarm, setSwarm] = useState(null);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = process.env.NODE_ENV === 'development'
      ? window.location.hostname + ':8080'
      : window.location.host;
    const bootstrapAddress = `${proto}://${host}`;

    console.log({bootstrapAddress});

    const connManager = new ConnManager(bootstrapAddress);

    Client.create(connManager).then(({ppsppClient, swarmUri}) => {
      setPpsppClient(ppsppClient);
      setSwarmUri(swarmUri);
    });
  }, []);

  if (swarm) {
    // return <DiagnosticMenu swarm={swarm} />;
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
