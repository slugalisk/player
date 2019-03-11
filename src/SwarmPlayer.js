import React, {useRef, useEffect, useState} from 'react';
import muxjs from 'mux.js';
import {ChunkedFragmentedReadStream} from './chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';
import {Buffer} from 'buffer';
import PlayButton from './PlayButton';

import './SwarmPlayer.css';

const useSwarmMediaSource = swarm => {
  const [mediaSource, setMediaSource] = useState();

  useEffect(() => {
    const mediaSource = new MediaSource();
    setMediaSource(mediaSource);

    mediaSource.addEventListener('sourceopen', () => handleSourceOpen(mediaSource));
  }, []);

  const handleSourceOpen = mediaSource => {
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
  };

  return [mediaSource];
};

const SwarmPlayer = ({swarm}) =>{
  const video = useRef(null);
  const [mediaSource] = useSwarmMediaSource(swarm);
  const [played, setPlayed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(null);

  console.log({paused, volume});

  useEffect(() => {
    if (video.current == null || mediaSource == null) {
      return;
    }

    video.current.src = URL.createObjectURL(mediaSource);

    setVolume(video.current.volume);

    video.current.addEventListener('audioprocess', e => console.log(new Date().toUTCString(), 'audioprocess', e));
    video.current.addEventListener('canplay', e => console.log(new Date().toUTCString(), 'canplay', e));
    video.current.addEventListener('canplaythrough', e => console.log(new Date().toUTCString(), 'canplaythrough', e));
    video.current.addEventListener('complete', e => console.log(new Date().toUTCString(), 'complete', e));
    video.current.addEventListener('durationchange', e => console.log(new Date().toUTCString(), 'durationchange', e));
    video.current.addEventListener('emptied', e => console.log(new Date().toUTCString(), 'emptied', e));
    video.current.addEventListener('ended', e => console.log(new Date().toUTCString(), 'ended', e));
    video.current.addEventListener('loadeddata', e => console.log(new Date().toUTCString(), 'loadeddata', e));
    video.current.addEventListener('loadedmetadata', e => console.log(new Date().toUTCString(), 'loadedmetadata', e));
    video.current.addEventListener('pause', e => console.log(new Date().toUTCString(), 'pause', e));
    video.current.addEventListener('play', e => console.log(new Date().toUTCString(), 'play', e));
    video.current.addEventListener('playing', e => console.log(new Date().toUTCString(), 'playing', e));
    video.current.addEventListener('ratechange', e => console.log(new Date().toUTCString(), 'ratechange', e));
    video.current.addEventListener('seeked', e => console.log(new Date().toUTCString(), 'seeked', e));
    video.current.addEventListener('seeking', e => console.log(new Date().toUTCString(), 'seeking', e));
    video.current.addEventListener('stalled', e => console.log(new Date().toUTCString(), 'stalled', e));
    video.current.addEventListener('suspend', e => console.log(new Date().toUTCString(), 'suspend', e));
    // video.current.addEventListener('timeupdate', e => console.log(new Date().toUTCString(), 'timeupdate', e));
    video.current.addEventListener('volumechange', e => console.log(new Date().toUTCString(), 'volumechange', e));
    video.current.addEventListener('waiting', e => console.log(new Date().toUTCString(), 'waiting', e));

    const handleEnded = () => {
      setPlaying(false);
      setLoading(false);
    };

    const handleComplete = () => {
      setPlaying(false);
      setLoading(false);
    };

    const handlePause = () => {
      setPlaying(false);
    };

    const handlePlaying = () => {
      setPaused(false);
      setPlaying(true);
      setPlayed(true);
    };

    const handleCanplay = () => {
      setBuffering(false);
    };

    const handleVolumeChange = () => {
      setVolume(video.current.volume);
    };

    const handleWaiting = () => {
      setPlaying(false);
      setBuffering(true);
    };

    video.current.addEventListener('ended', handleEnded);
    video.current.addEventListener('complete', handleComplete);
    video.current.addEventListener('pause', handlePause);
    video.current.addEventListener('playing', handlePlaying);
    video.current.addEventListener('canplay', handleCanplay);
    video.current.addEventListener('volumechange', handleVolumeChange);
    video.current.addEventListener('waiting', handleWaiting);

    play();

    return () => {
      video.current.removeEventListener('ended', handleEnded);
      video.current.removeEventListener('complete', handleComplete);
      video.current.removeEventListener('pause', handlePause);
      video.current.removeEventListener('playing', handlePlaying);
      video.current.removeEventListener('canplay', handleCanplay);
      video.current.removeEventListener('volumechange', handleVolumeChange);
      video.current.removeEventListener('waiting', handleWaiting);
    };
  }, [video, mediaSource]);

  const play = async () => {
    try {
      await video.current.play();
    } catch (e) {
      video.current.muted = true;
      try {
        await video.current.play();
      } catch (e) {
        console.warn('error playing video', e);
      }
    }
  };

  // TODO: use a generic loading animation for buffering
  const playButton = (
    <PlayButton
      visible={!playing}
      onClick={play}
      blur={!played}
      flicker={loading && !played}
      spin={buffering && played}
      disabled={buffering || !played}
    />
  );

  return (
    <React.Fragment>
      <DiagnosticMenu swarm={swarm} />
      <video
        onClick={e => e.preventDefault()}
        className="swarm-player-video"
        ref={video}
      />
      {playButton}
    </React.Fragment>
  );
};

export default SwarmPlayer;
