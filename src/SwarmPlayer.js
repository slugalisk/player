import React, {useRef, useEffect, useState} from 'react';
import muxjs from 'mux.js';
import {ChunkedFragmentedReadStream} from './chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';
import {Buffer} from 'buffer';
import PlayButton from './PlayButton';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faSyncAlt} from '@fortawesome/free-solid-svg-icons';

import './SwarmPlayer.scss';

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

export const VideoReadyState = {
  // No information is available about the media resource.
  HAVE_NOTHING: 0,
  // Enough of the media resource has been retrieved that the metadata attributes
  // are initialized. Seeking will no longer raise an exception.
  HAVE_METADATA: 1,
  // Data is available for the current playback position, but not enough to
  // actually play more than one frame.
  HAVE_CURRENT_DATA: 2,
  // Data for the current playback position as well as for at least a little
  // bit of time into the future is available (in other words, at least two frames of video, for example).
  HAVE_FUTURE_DATA: 3,
  // Enough data is available—and the download rate is high enough—that the
  // media can be played through to the end without interruption.
  HAVE_ENOUGH_DATA: 4,
};

const useVideo = () => {
  const ref = useRef();
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [muted, setMuted] = useState(null);
  const [volume, setVolume] = useState(null);
  const [readyState, setReadyState] = useState(0);

  useEffect(() => {
    if (ref.current == null) {
      return;
    }

    setMuted(ref.current.muted);
    setVolume(ref.current.volume);
    setPaused(ref.current.paused);
    setReadyState(ref.current.readyState);

    ref.current.addEventListener('audioprocess', e => console.log(new Date().toUTCString(), 'audioprocess', e));
    ref.current.addEventListener('canplay', e => console.log(new Date().toUTCString(), 'canplay', e));
    ref.current.addEventListener('canplaythrough', e => console.log(new Date().toUTCString(), 'canplaythrough', e));
    ref.current.addEventListener('complete', e => console.log(new Date().toUTCString(), 'complete', e));
    ref.current.addEventListener('durationchange', e => console.log(new Date().toUTCString(), 'durationchange', e));
    ref.current.addEventListener('emptied', e => console.log(new Date().toUTCString(), 'emptied', e));
    ref.current.addEventListener('ended', e => console.log(new Date().toUTCString(), 'ended', e));
    ref.current.addEventListener('loadeddata', e => console.log(new Date().toUTCString(), 'loadeddata', e));
    ref.current.addEventListener('loadedmetadata', e => console.log(new Date().toUTCString(), 'loadedmetadata', e));
    ref.current.addEventListener('pause', e => console.log(new Date().toUTCString(), 'pause', e));
    ref.current.addEventListener('play', e => console.log(new Date().toUTCString(), 'play', e));
    ref.current.addEventListener('playing', e => console.log(new Date().toUTCString(), 'playing', e));
    ref.current.addEventListener('ratechange', e => console.log(new Date().toUTCString(), 'ratechange', e));
    ref.current.addEventListener('seeked', e => console.log(new Date().toUTCString(), 'seeked', e));
    ref.current.addEventListener('seeking', e => console.log(new Date().toUTCString(), 'seeking', e));
    ref.current.addEventListener('stalled', e => console.log(new Date().toUTCString(), 'stalled', e));
    ref.current.addEventListener('suspend', e => console.log(new Date().toUTCString(), 'suspend', e));
    // ref.current.addEventListener('timeupdate', e => console.log(new Date().toUTCString(), 'timeupdate', e));
    ref.current.addEventListener('volumechange', e => console.log(new Date().toUTCString(), 'volumechange', e));
    ref.current.addEventListener('waiting', e => console.log(new Date().toUTCString(), 'waiting', e));
    ref.current.addEventListener('readystatechange', e => console.log(new Date().toUTCString(), 'readystatechange', e));
  }, [ref]);

  const onEnded = () => {
    setPlaying(false);
    setEnded(false);
    setWaiting(false);
  };

  const onPause = () => {
    setPlaying(false);
    setPaused(true);
  };

  const onPlaying = () => {
    setPaused(false);
    setPlaying(true);
    setReadyState(ref.current.readyState);
  };

  const onCanPlay = () => {
    setWaiting(false);
    setLoaded(true);
    setReadyState(ref.current.readyState);
  };

  const onCanPlayThrough = () => {
    setWaiting(false);
    setLoaded(true);
    setReadyState(ref.current.readyState);
  };

  const onVolumeChange = () => {
    setVolume(ref.current.volume);
  };

  const onWaiting = () => {
    setPlaying(false);
    setWaiting(true);
    setReadyState(ref.current.readyState);
  };

  const onDurationChange = () => {
    setReadyState(ref.current.readyState);
  };

  const onLoadedMetadata = (e) => {
    setReadyState(ref.current.readyState);
  };

  const onLoadedData = () => {
    setReadyState(ref.current.readyState);
  };

  // const onTimeUpdate = () => {
  //   console.log({
  //     buffered: ref.current.buffered,
  //     seekable: ref.current.seekable,
  //   });
  // };

  const play = async () => {
    try {
      await ref.current.play();
    } catch (e) {
      ref.current.muted = true;
      try {
        await ref.current.play();
      } catch (e) {
        console.warn('error playing video', e);
      }
    }
  };

  return [
    {
      readyState,
      loaded,
      playing,
      paused,
      ended,
      waiting,
      muted,
      volume,
    },
    {
      ref,
      onEnded,
      onPause,
      onPlaying,
      onCanPlay,
      onCanPlayThrough,
      onVolumeChange,
      onWaiting,
      onDurationChange,
      onLoadedMetadata,
      onLoadedData,
      // onTimeUpdate,
    },
    {
      play,
    },
  ];
};

const SwarmPlayer = ({swarm, indexSwarm}) =>{
  const [videoState, videoProps, videoControls] = useVideo();
  const mediaSource = useSwarmMediaSource(swarm);

  useEffect(() => {
    if (videoProps.ref.current != null && mediaSource != null) {
      videoProps.ref.current.src = URL.createObjectURL(mediaSource);
      videoControls.play();
    }
  }, [videoProps.ref, mediaSource]);

  console.log(videoState);

  const playButton = (videoState.waiting && videoState.loaded) ? (
    <div className="swarm_player__waiting_spinner">
      <FontAwesomeIcon icon={faSyncAlt} />
    </div>
  ) : (
    <PlayButton
      visible={!videoState.playing}
      onClick={videoControls.play}
      flicker={videoState.ended && !videoState.loaded}
      spin={videoState.waiting && videoState.loaded}
      disabled={videoState.waiting || !videoState.loaded}
      blur={true}
    />
  );

  return (
    <React.Fragment>
      {/* <DiagnosticMenu swarm={indexSwarm} containerClass="diagnostic-menu--indent-1" /> */}
      <DiagnosticMenu swarm={swarm} />
      <video
        onClick={e => e.preventDefault()}
        className="swarm_player__video"
        {...videoProps}
      />
      {playButton}
    </React.Fragment>
  );
};

export default SwarmPlayer;
