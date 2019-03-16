import React, {useEffect, useState, useMemo, useRef} from 'react';
import URI from './ppspp/uri';
import DiagnosticMenu from './DiagnosticMenu';
import SwarmPlayer from './SwarmPlayer';
import {ChunkedReadStream} from './chunkedStream';
import {Client} from './client';
import {ConnManager} from './wrtc';
import {PubSubConsumer} from './pubsub';
import PlayButton from './PlayButton';
import qs from 'qs';
import {useTimeout, useAsync} from 'react-use';
import hexToUint8Array from './hexToUint8Array';
import moment from 'moment';

import './App.scss';

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

const useIndexSwarm = client => usePubSubSwarm(client, 'index');

const useQuery = queryString => useMemo(() => {
  return qs.parse(queryString, {ignoreQueryPrefix: true}) || {};
}, [queryString]);

const NoiseLogger = ({swarm}) => {
  useEffect(() => {
    if (swarm) {
      const stream = new ChunkedReadStream(swarm);
      stream.on('data', ({length}) => console.log(`received ${length} bytes`));
    }
  }, [swarm]);

  return <DiagnosticMenu swarm={swarm} />;
};

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

const useChatSwarm = client => {
  const [consumer] = usePubSubSwarm(client, 'chat');
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (consumer == null) {
      return;
    }

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

const ChatMessages = ({messages}) => {
  const items = messages.map(({time, message, id}) => (
    <li className="message" key={id}>
      <span className="timestamp" title={time}>{moment(time).format('HH:mm:ss')}</span>
      <span className="text">{message}</span>
    </li>
  )).reverse();

  return (
    <ul className="messages">
      {items}
    </ul>
  );
};

const Chat = ({client}) => {
  const [messages, sendMessage] = useChatSwarm(client);
  const [message, setMessage] = useState('');
  const input = useRef();

  const handleSubmit = e => {
    e.preventDefault();

    sendMessage(message);
    setMessage('');
  };

  const handleChange = e => {
    setMessage(e.target.value);
  };

  return (
    <div className="chat">
      <form className="compose-form" onSubmit={handleSubmit}>
        <input
          className="message-input"
          type="text"
          placeholder="write a message..."
          onChange={handleChange}
          value={message}
        />
        <button className="send-button">Send</button>
      </form>
      <ChatMessages messages={messages} />
    </div>
  );
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

  const index = null;
  const indexSwarm = null;
  // const [index, indexSwarm] = useIndexSwarm(client);
  const [swarm, joinSwarm] = useSwarm(client);

  const swarmDesc = client?.bootstrap.swarms.find(desc => desc.name === swarmName);
  const error = clientError || (autoPlay && clientTimeout) || !(clientLoading || swarmDesc);

  useEffect(() => {
    if (autoPlay && swarmDesc) {
      setImmediate(() => joinSwarm(swarmDesc.uri));
    }
  }, [autoPlay, swarmDesc]);

  if (swarm) {
    const Component = {
      'application/octet-stream': NoiseLogger,
      'application/json': PubSubLogger,
      'video/mpeg-ts': SwarmPlayer,
    }[swarmDesc.contentType];

    return (
      <Component
        swarm={swarm}
        index={index}
        indexSwarm={indexSwarm}
      />
    );
  }

  const indexSwarmDiagnosticMenu = indexSwarm && <DiagnosticMenu swarm={indexSwarm} />;
  const chat = 'chat' in query && <Chat client={client} />;

  return (
    <>
      {chat}
      {indexSwarmDiagnosticMenu}
      <div className="idle">
        <div className="noise"></div>
      </div>
      <PlayButton
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
