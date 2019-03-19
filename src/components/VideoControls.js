import React, {useState} from 'react';
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
  PictureInPictureAlt,
} from '@material-ui/icons';
import ReactTooltip from 'react-tooltip';
import VideoProgressBar from './VideoProgressBar';

import './VideoPlayer.scss';

const Tooltips = () => (
  <ReactTooltip
    id="controls-tooltips"
    place="top"
    effect="solid"
  />
);

const Button = ({className, tooltip, icon: Icon, onClick}) => (
  <div className={className}>
    <Tooltips />
    <button
      data-for="controls-tooltips"
      data-tip={tooltip}
      onClick={onClick}
    >
      <Icon />
    </button>
  </div>
);

const PiPButton = ({supported, toggle}) => !supported ? null : (
  <Button
    className="pip"
    tooltip="Miniplayer"
    onClick={toggle}
    icon={PictureInPictureAlt}
  />
);

const FullscreenButton = ({supported, enabled, toggle}) => !supported ? null : (
  <Button
    className="fullscreen"
    tooltip={enabled ? 'Exit full screen' : 'Full screen'}
    onClick={toggle}
    icon={enabled ? FullscreenExit : Fullscreen}
  />
);

const VideoControls = ({
  fullscreen,
  toggleFullscreen,
  videoState,
  videoControls,
  visible,
}) => {
  const {
    playing,
    volume,
    supportPiP,
  } = videoState;

  const {
    setVolume,
    play,
    pause,
    unmute,
    mute,
    togglePiP,
  } = videoControls;

  const [active, setActive] = useState(false);

  const volumeIcons = [
    VolumeOff,
    VolumeMute,
    VolumeDown,
    VolumeUp,
  ];
  const volumeLevel = Math.ceil(volume * (volumeIcons.length - 1));
  const VolumeIcon = volumeIcons[volumeLevel];
  const handleVolumeClick = () => volume === 0 ? unmute() : mute();

  const controlsClassName = classNames({
    video_player__controls: true,
    visible: visible || active,
  });

  return (
    <div className={controlsClassName}>
      <div className="controls_group">
        <Button
          className="play"
          tooltip={playing === 0 ? 'Pause' : 'Play'}
          onClick={playing ? pause : play}
          icon={playing ? Pause : PlayArrow}
        />
        <div className="volume">
          <Tooltips />
          <button
            data-for="controls-tooltips"
            data-tip={volume === 0 ? 'Unmute' : 'Mute'}
            onClick={handleVolumeClick}
          >
            <VolumeIcon className={`volume-level-${volumeLevel}`} />
          </button>
          <VideoVolume
            onUpdate={setVolume}
            onSlideStart={() => setActive(true)}
            onSlideEnd={() => setActive(false)}
            value={volume}
          />
        </div>
      </div>
      <div className="progress_bar">
        <VideoProgressBar
          videoState={videoState}
          videoControls={videoControls}
        />
      </div>
      <div className="controls_group">
        <PiPButton supported={supportPiP} toggle={togglePiP} />
        <FullscreenButton
          supported={document.fullscreenEnabled}
          enabled={fullscreen}
          toggle={toggleFullscreen}
        />
      </div>
    </div>
  );
};

export default VideoControls;
