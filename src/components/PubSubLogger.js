import React from 'react';
import {PubSubConsumer} from '../pubsub';
import DiagnosticMenu from './DiagnosticMenu';
import useReady from '../hooks/useReady';

const PubSubLogger = ({indexSwarm, swarm}) => {
  useReady(() => {
    const consumer = new PubSubConsumer(swarm);
    consumer.on('message', message => console.log(message));
  }, [swarm]);

  return (
    <>
      <DiagnosticMenu swarm={swarm} containerClass="diagnostic-menu--indent-1" />
      <DiagnosticMenu swarm={indexSwarm} />
    </>
  );
};

export default PubSubLogger;
