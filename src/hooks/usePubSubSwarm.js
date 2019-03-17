
import {useEffect, useState} from 'react';
import URI from '../ppspp/uri';
import {PubSubConsumer} from '../pubsub';

const usePubSubSwarm = (client, name) => {
  const [swarm, setSwarm] = useState(null);
  const [consumer, setConsumer] = useState(null);

  useEffect(() => {
    if (client) {
      setImmediate(() => {
        const {uri} = client.bootstrap.swarms.find(desc => desc.name === name);
        const swarm = client.ppsppClient.joinSwarm(URI.parse(uri));
        const consumer = new PubSubConsumer(swarm);

        setSwarm(swarm);
        setConsumer(consumer);

        return () => client.ppsppClient.leaveSwarm(URI.parse(uri));
      });
    }
  }, [client]);

  return [consumer, swarm];
};

export default usePubSubSwarm;
