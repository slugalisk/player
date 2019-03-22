import React, {useState, useRef} from 'react';
import {Client} from '../client';
import {ConnManager} from '../wrtc';
import {useAsync} from 'react-use';
import useReady from '../hooks/useReady';
import {getDefaultBootstrapAddress, useSwarm} from './App';
import Injector from '../ppspp/injector';
import {ChunkedWriteStream, ChunkedReadStream} from '../chunkedStream';
import {LiveSignatureAlgorithm} from '../ppspp/constants';
import {Buffer} from 'buffer';
import DiagnosticMenu from './DiagnosticMenu';
import mtw from 'mediastream-to-webm';

import './App.scss';
import './MediaDeviceTest.scss';

const MIME_TYPE = 'video/webm; codecs="vp8"';

const MediaDeviceTest = props => {
  const client = useAsync(() => Client.create(new ConnManager(getDefaultBootstrapAddress())), []).value;
  const [clientSwarm, joinSwarm] = useSwarm(client);
  const [serverSwarm, setServerSwarm] = useState(null);
  const [swarmUri, setSwarmUri] = useState('');

  const swarm = clientSwarm || serverSwarm;
  const videoRef = useRef();

  useReady(() => {
    const chunkStream = new ChunkedReadStream(swarm);
    const webmStream = mtw.DecodedStream({
      mimeType: MIME_TYPE,
      videoElement: videoRef.current,
    });

    chunkStream.on('data', data => {
      webmStream.write(Buffer.concat(data.chunks, data.length));
    });
  }, [videoRef, swarm]);

  if (swarm) {
    return (
      <div className="media_device_test__player">
        <video
          controls
          autoPlay
          ref={videoRef}
        />
        <DiagnosticMenu swarm={swarm} />
        <input defaultValue={swarm.uri.toString()} />
      </div>
    );
  }

  const handleUriChange = e => setSwarmUri(e.target.value);

  const handleBeginStreamClick = async e => {
    e.preventDefault();

    const getDisplayMediaResult = navigator.mediaDevices.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia({video: true, frameRate: 30})
      : navigator.mediaDevices.getUserMedia({video: {mediaSource: 'screen'}, frameRate: 30});

    const webmStream = mtw.EncodedStream(await getDisplayMediaResult, {
      mimeType: MIME_TYPE,
    });

    const injector = await Injector.create({
      chunkSize: 32 * 1024,
      chunksPerSignature: 16,
      liveSignatureAlgorithm: LiveSignatureAlgorithm.RSASHA1,
    });

    const writer = new ChunkedWriteStream(injector);

    // TODO: mtw doesn't work with webms from firefox...
    webmStream.on('data', d => writer.write(d));

    setServerSwarm(injector.swarm);
    client.ppsppClient.publishSwarm(injector.swarm);
  };

  const streamButton = navigator.mediaDevices.getDisplayMedia && (
    <button onClick={handleBeginStreamClick}>Stream</button>
  );

  return (
    <form className="media_device_test__form" onSubmit={() => joinSwarm(swarmUri)}>
      <input
        onChange={handleUriChange}
        placeholder="Enter Swarm URI"
        value={swarmUri}
      />
      <button>Join</button>
      {streamButton}
    </form>
  );
};

export default MediaDeviceTest;
