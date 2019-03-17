import React, {useEffect} from 'react';
import {PubSubConsumer} from '../pubsub';
import DiagnosticMenu from './DiagnosticMenu';

const PubSubLogger = ({indexSwarm, swarm}) => {
  useEffect(() => {
    if (swarm) {
      const consumer = new PubSubConsumer(swarm);
      consumer.on('message', message => console.log(message));
    }
  }, [swarm]);

  return (
    <>
      <DiagnosticMenu swarm={swarm} containerClass="diagnostic-menu--indent-1" />
      <DiagnosticMenu swarm={indexSwarm} />
    </>
  );
};

export default PubSubLogger;
