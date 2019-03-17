import React, {useEffect} from 'react';
import {ChunkedReadStream} from '../chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';

const NoiseLogger = ({swarm}) => {
  useEffect(() => {
    if (swarm) {
      const stream = new ChunkedReadStream(swarm);
      stream.on('data', ({length}) => console.log(`received ${length} bytes`));
    }
  }, [swarm]);

  return <DiagnosticMenu swarm={swarm} />;
};

export default NoiseLogger;
