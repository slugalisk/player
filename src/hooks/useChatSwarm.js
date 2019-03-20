import {useState} from 'react';
import usePubSubSwarm from './usePubSubSwarm';
import hexToUint8Array from '../hexToUint8Array';
import useReady from '../hooks/useReady';

const useChatSwarm = client => {
  const [consumer] = usePubSubSwarm(client, 'chat');
  const [messages, setMessages] = useState([]);

  useReady(() => {
    const handleMessage = message => setMessages(prev => ([
      ...prev.slice(prev.length > 100 ? 1 : 0),
      message,
    ]));

    consumer.on('message', e => console.log(e));
    consumer.on('message', handleMessage);
    return () => consumer.removeListener('message', handleMessage);
  }, [consumer]);

  const sendMessage = message => {
    if (client.dhtClient) {
      client.dhtClient.send(
        hexToUint8Array(client.bootstrap.bootstrapId),
        'chat.message',
        {message},
      );
    }
  };

  return [messages, sendMessage];
};

export default useChatSwarm;
