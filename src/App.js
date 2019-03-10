import React, {useEffect, useState} from 'react';
import URI from './ppspp/uri';
import DiagnosticMenu from './DiagnosticMenu';
import SwarmPlayer from './SwarmPlayer';
import {Client} from './client';
import {ConnManager} from './wrtc';
import {ChunkedReadStream} from './chunkedStream';
import qs from 'qs';

import './App.css';

const useQueryString = queryString => {
  const [query, setQuery] = useState({});

  useEffect(() => {
    setQuery(qs.parse(queryString, {ignoreQueryPrefix: true}) || {});
  }, [queryString]);

  return [query];
};

const App = props => {
  const [ppsppClient, setPpsppClient] = useState(null);
  const [swarmUri, setSwarmUri] = useState('');
  const [injectorType, setInjectorType] = useState('');
  const [swarm, setSwarm] = useState(null);
  const [query] = useQueryString(props.location.search);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = process.env.NODE_ENV === 'development'
      ? window.location.hostname + ':8080'
      : window.location.host;
    const bootstrapAddress = `${proto}://${host}`;

    console.log({bootstrapAddress});

    const connManager = new ConnManager(bootstrapAddress);

    Client.create(connManager).then(({ppsppClient, bootstrap: {swarmUri, injectorType}}) => {
      setPpsppClient(ppsppClient);
      setSwarmUri(swarmUri);
      setInjectorType(injectorType);
    });
  }, []);

  const joinSwarm = () => {
    console.log(swarmUri);
    const uri = URI.parse(swarmUri);
    console.log('joining', uri);

    const swarm = ppsppClient.joinSwarm(uri);
    if (injectorType === 'noise') {
      const stream = new ChunkedReadStream(swarm);
      stream.on('data', d => console.log(`received ${d.length} bytes`));
    }
    setSwarm(swarm);
  };

  useEffect(() => {
    if (query.autoplay != null && swarmUri) {
      setImmediate(joinSwarm);
    }
  }, [swarmUri, query]);

  const onJoinSubmit = e => {
    e.preventDefault();
    joinSwarm();
  };

  const onInputChange = e => {
    setSwarmUri(e.target.value);
  };

  if (swarm) {
    return injectorType === 'noise'
      ? <DiagnosticMenu swarm={swarm} />
      : <SwarmPlayer swarm={swarm} />;
  }

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
