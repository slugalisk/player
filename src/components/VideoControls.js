import React from 'react';
import VideoVolume from './VideoVolume';
import classNames from 'classnames';
import {
  Pause,
  PlayArrow,
  VolumeOff,
  VolumeMute,
  VolumeDown,
  VolumeUp,
  Fullscreen,
  FullscreenExit,
} from '@material-ui/icons';

import './VideoPlayer.scss';

const VideoControls = ({
  playing,
  pause,
  play,
  volume,
  unmute,
  mute,
  fullscreen,
  toggleFullscreen,
  visible,
  setVolume,
}) => {
  const playButton = playing
    ? <Pause onClick={pause} />
    : <PlayArrow onClick={play} />;

  const volumeIcons = [
    VolumeOff,
    VolumeMute,
    VolumeDown,
    VolumeUp,
  ];
  const VolumeIcon = volumeIcons[Math.ceil(volume * (volumeIcons.length - 1))];
  const handleVolumeClick = () => volume === 0 ? unmute() : mute();

  let fullscreenButton;
  if (document.fullscreenEnabled) {
    const Icon = fullscreen ? FullscreenExit : Fullscreen;
    fullscreenButton = (
      <div className="settings">
        <Icon onClick={toggleFullscreen} />
      </div>
    );
  }

  const controlsClassName = classNames({
    swarm_player__controls: true,
    visible: visible,
  });

  return (
    <div className={controlsClassName}>
      <div className="swarm_player__controls__group">
        <div className="play">
          {playButton}
        </div>
        <div className="volume">
          <VolumeIcon onClick={handleVolumeClick} className="mute_button" />
          <VideoVolume onUpdate={setVolume} value={volume} />
        </div>
      </div>
      <div className="swarm_player__controls__group">
        {fullscreenButton}
      </div>
    </div>
  );
};

export default VideoControls;
