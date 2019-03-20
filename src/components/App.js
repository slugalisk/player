import React, {useState} from 'react';
import URI from '../ppspp/uri';
import {Client} from '../client';
import {ConnManager} from '../wrtc';
import LogoButton from './LogoButton';
import {useTimeout, useAsync} from 'react-use';
import useQuery from '../hooks/useQuery';
import VideoPlayer from './VideoPlayer';
import useReady from '../hooks/useReady';

import './App.scss';

const NoiseLogger = React.lazy(() => import('./NoiseLogger'));
const PubSubLogger = React.lazy(() => import('./PubSubLogger'));

const getDefaultBootstrapAddress = () => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = process.env.NODE_ENV === 'development'
    ? window.location.hostname + ':8080'
    : window.location.host;
  return `${proto}://${host}`;
};

const useSwarm = ({ppsppClient} = {}) => {
  const [swarm, setSwarm] = useState(null);
  const join = uri => setSwarm(ppsppClient.joinSwarm(URI.parse(uri)));
  return [swarm, join];
};

const App = ({
  location,
  match: {params},
  clientTimeoutMs = 5000,
}) => {
  const query = useQuery(location.search);
  const autoPlay = 'autoplay' in query;
  const bootstrapAddress = query.bootstrap || getDefaultBootstrapAddress();
  const swarmName = params.name;

  const clientTimeout = useTimeout(clientTimeoutMs);
  const {
    loading: clientLoading,
    error: clientError,
    value: client,
  } = useAsync(() =>  Client.create(new ConnManager(bootstrapAddress)), []);

  const [swarm, joinSwarm] = useSwarm(client);

  const swarmDesc = client?.bootstrap.swarms.find(desc => desc.name === swarmName);
  const error = clientError || (autoPlay && clientTimeout) || !(clientLoading || swarmDesc);

  useReady(() => {
    setImmediate(() => joinSwarm(swarmDesc.uri));
  }, [autoPlay, swarmDesc]);

  if (swarm) {
    const Component = {
      'application/octet-stream': NoiseLogger,
      'application/json': PubSubLogger,
      'video/mpeg-ts': VideoPlayer,
    }[swarmDesc.contentType];

    return (
      <Component swarm={swarm} />
    );
  }

  return (
    <>
      <div className="idle">
        <div className="noise"></div>
      </div>
      <LogoButton
        disabled={clientLoading || autoPlay || error}
        onClick={() => joinSwarm(swarmDesc.uri)}
        pulse={!clientLoading && !autoPlay}
        flicker={clientLoading || autoPlay}
        error={error}
        blur
      />
    </>
  );
};

export default App;
