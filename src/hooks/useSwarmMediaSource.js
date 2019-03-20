import {useState} from 'react';
import muxjs from 'mux.js';
import {ChunkedFragmentedReadStream} from '../chunkedStream';
import {Buffer} from 'buffer';
import useReady from './useReady';

const MIME_TYPE = 'video/mp4; codecs="mp4a.40.5,avc1.64001F"';

const useSwarmMediaSource = swarm => {
  const [sourceBuffer, setSourceBuffer] = useState(null);

  const [operations] = useState([]);

  const transformBuffer = newOperation => {
    const readOnly = sourceBuffer === null || sourceBuffer.updating;

    if (newOperation !== undefined && (operations.length !== 0 || readOnly)) {
      operations.push(newOperation);
      setImmediate(transformBuffer);
      return;
    }

    if (readOnly) {
      return;
    }

    const operation = newOperation || operations.shift();
    if (operation === undefined) {
      return;
    }

    try {
      operation(sourceBuffer);
    } catch (e) {
      operations.unshift(operation);
      setImmediate(transformBuffer);
    }
  };

  const [mediaSource] = useState(() => {
    const mediaSource = new MediaSource();

    const handleSourceOpen = () => setSourceBuffer(mediaSource.addSourceBuffer(MIME_TYPE));
    mediaSource.addEventListener('sourceopen', handleSourceOpen);

    return mediaSource;
  }, []);

  useReady(() => {
    sourceBuffer.addEventListener('error', e => console.log(e));
    sourceBuffer.addEventListener('updateend', () => transformBuffer());

    const transmuxer = new muxjs.mp4.Transmuxer();

    let initSet = false;
    transmuxer.on('data', event => {
      if (event.type === 'combined') {
        const buf = initSet
          ? event.data
          : Buffer.concat([Buffer.from(event.initSegment), Buffer.from(event.data)]);
        initSet = true;

        transformBuffer(sourceBuffer => sourceBuffer.appendBuffer(buf));
      } else {
        console.warn('unhandled event', event.type);
      }
    });

    const stream = new ChunkedFragmentedReadStream(swarm);
    stream.on('start', data => transmuxer.push(data));
    stream.on('data', data => transmuxer.push(data));
    stream.on('end', data => {
      transmuxer.push(data);
      transmuxer.flush();
    });
  }, [sourceBuffer]);

  const truncate = duration => transformBuffer(sourceBuffer => {
    const buffered = sourceBuffer?.buffered;
    if (buffered?.length && buffered.end(0) > duration) {
      const offset = buffered.end(0) - duration;
      sourceBuffer.remove(0, offset);
    }
  });

  return [mediaSource, truncate];
};

export default useSwarmMediaSource;
