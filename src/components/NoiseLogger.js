import React from 'react';
import {ChunkedReadStream} from '../chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';
import useReady from '../hooks/useReady';

const NoiseLogger = ({swarm}) => {
  useReady(() => {
    const stream = new ChunkedReadStream(swarm);
    stream.on('data', ({length}) => console.log(`received ${length} bytes`));
  }, [swarm]);

  return <DiagnosticMenu swarm={swarm} />;
};

export default NoiseLogger;
