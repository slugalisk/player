import React, {useEffect, useState, useMemo} from 'react';
import URI from './ppspp/uri';
import DiagnosticMenu from './DiagnosticMenu';
import SwarmPlayer from './SwarmPlayer';
import {Client} from './client';
import {ConnManager} from './wrtc';
import {ChunkedReadStream} from './chunkedStream';
import PlayButton from './PlayButton';
import qs from 'qs';
import {useTimeout, useAsync} from 'react-use';

import './App.css';

const getBootstrapAddress = () => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = process.env.NODE_ENV === 'development'
    ? window.location.hostname + ':8080'
    : window.location.host;
  return `${proto}://${host}`;
};

const useSwarm = ({ppsppClient, bootstrap: {swarmUri} = {}}) => {
  const [swarm, setSwarm] = useState(null);
  const join = () => setSwarm(ppsppClient.joinSwarm(URI.parse(swarmUri)));
  return [swarm, join];
};

const useQuery = queryString => useMemo(() => {
  return qs.parse(queryString, {ignoreQueryPrefix: true}) || {};
}, [queryString]);

const App = ({
  location,
  clientTimeoutMs = 5000,
}) => {
  const clientTimeout = useTimeout(clientTimeoutMs);
  const {
    loading: clientLoading,
    value: client = {},
  } = useAsync(() => Client.create(new ConnManager(getBootstrapAddress())), []);
  console.log({client});
  const [swarm, joinSwarm] = useSwarm(client);

  const query = useQuery(location.search);

  const noiseInjector = client?.bootstrap?.injectorType === 'noise';
  const autoPlay = 'autoplay' in query;
  const loading = clientLoading || !client.ppsppClient;

  useEffect(() => {
    if (autoPlay && !loading) {
      setImmediate(joinSwarm);
    }
  }, [autoPlay && loading]);

  useEffect(() => {
    if (noiseInjector && swarm) {
      const stream = new ChunkedReadStream(swarm);
      stream.on('data', d => console.log(`received ${d.length} bytes`));
    }
  }, [noiseInjector, swarm]);

  if (swarm) {
    return noiseInjector
      ? <DiagnosticMenu swarm={swarm} />
      : <SwarmPlayer swarm={swarm} />;
  }

  return (
    <>
      <div className="idle">
        <div className="noise"></div>
      </div>
      <PlayButton
        disabled={loading}
        onClick={joinSwarm}
        pulse={!autoPlay}
        flicker={loading || autoPlay}
        error={loading && clientTimeout}
        blur
      />
    </>
  );
};

export default App;
