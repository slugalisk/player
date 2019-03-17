import {useState} from 'react';
import muxjs from 'mux.js';
import {ChunkedFragmentedReadStream} from '../chunkedStream';
import {Buffer} from 'buffer';

const useSwarmMediaSource = swarm => {
  const [mediaSource] = useState(() => {
    const mediaSource = new MediaSource();
    mediaSource.addEventListener('sourceopen', handleSourceOpen);
    return mediaSource;
  }, []);

  function handleSourceOpen() {
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="mp4a.40.5,avc1.64001F"');
    // sourceBuffer.addEventListener('updatestart', e => console.log(e));
    // sourceBuffer.addEventListener('updateend', e => console.log(e));
    sourceBuffer.addEventListener('error', e => console.log(e));

    const videoSegments = [];
    const appendBuffer = newSegment => {
      if (newSegment !== undefined && (videoSegments.length !== 0 || sourceBuffer.updating)) {
        videoSegments.push(newSegment);
        return;
      }

      if (sourceBuffer.updating) {
        return;
      }

      const segment = newSegment || videoSegments.shift();
      if (segment === undefined) {
        return;
      }

      try {
        sourceBuffer.appendBuffer(segment);
      } catch (e) {
        videoSegments.unshift(segment);
        setImmediate(appendBuffer);
      }
    };

    sourceBuffer.addEventListener('updateend', () => appendBuffer());

    const transmuxer = new muxjs.mp4.Transmuxer();
    let initSet = false;
    transmuxer.on('data', event => {
      if (event.type === 'combined') {
        const buf = initSet
          ? event.data
          : Buffer.concat([Buffer.from(event.initSegment), Buffer.from(event.data)]);
        initSet = true;

        appendBuffer(buf);
      } else {
        console.log('unhandled event', event.type);
      }
    });

    const stream = new ChunkedFragmentedReadStream(swarm);
    stream.on('start', data => transmuxer.push(data));
    stream.on('data', data => transmuxer.push(data));
    stream.on('end', data => {
      transmuxer.push(data);
      transmuxer.flush();
    });
  }

  return mediaSource;
};

export default useSwarmMediaSource;
