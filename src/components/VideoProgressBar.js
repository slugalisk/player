import React, {useEffect, useState} from 'react';
import {Slider, Rail, Handles, Tracks} from 'react-compound-slider';
import classNames from 'classnames';

export const Handle = ({
  domain: [min, max],
  handle: {id, value, percent},
  getHandleProps,
}) => (
  <div
    role="slider"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    style={{left: `${percent}%`}}
    className="video_progress_bar__handle"
    {...getHandleProps(id)}
  />
);

export const Track = ({source, target, getTrackProps}) => (
  <div
    className="video_progress_bar__track"
    style={{
      left: `${source.percent}%`,
      width: `${target.percent - source.percent}%`,
    }}
    {...getTrackProps()}
  />
);

const VideoProgressBar = ({
  videoState,
  videoControls,
}) => {
  const {
    playing,
    bufferStart,
    bufferEnd,
    currentTime,
  } = videoState;

  const {
    pause,
    play,
    setCurrentTime,
  } = videoControls;

  const [dragging, setDragging] = useState(false);
  const [wasPlaying, setWasPlaying] = useState(false);
  const [value, setValue] = useState(0);
  const [domainStart, setDomainStart] = useState(0);
  const [domainEnd, setDomainEnd] = useState(1);

  useEffect(() => {
    if (!dragging) {
      setValue(currentTime);
    }
  }, [dragging, currentTime]);

  // TODO: domain end from bitrate and last announced chunk?
  useEffect(() => {
    setDomainStart(bufferStart);
    setDomainEnd(bufferEnd);
  }, [bufferStart, bufferEnd]);

  const sliderClassNames = classNames({
    video_progress_bar__slider: true,
    dragging,
  });

  const clampValue = value => Math.min(bufferEnd, value);

  const handleUpdate = ([newValue]) => {
    const clampedValue = clampValue(newValue);
    if (dragging && clampedValue !== value) {
      setCurrentTime(clampedValue);
      setValue(clampedValue);
    }
  };

  const handleSlideStart = values => {
    setDragging(true);
    setWasPlaying(playing);
    pause();
  };

  const handleSlideEnd = values => {
    setDragging(false);

    if (wasPlaying) {
      play();
    }
  };

  const domainWidth = domainEnd - domainStart;
  const bufferRailStart = (bufferStart - domainStart) / domainWidth * 100;
  const bufferRailWidth = (bufferEnd - bufferStart) / domainWidth * 100;
  const bufferStyle = {
    left: `${bufferRailStart}%`,
    width: `${bufferRailWidth}%`,
  };

  return (
    <Slider
      mode={1}
      step={0.01}
      className={sliderClassNames}
      domain={[domainStart, domainEnd]}
      onUpdate={handleUpdate}
      onSlideStart={handleSlideStart}
      onSlideEnd={handleSlideEnd}
      values={[value]}
    >
      <Rail>
        {({getRailProps}) => (
          <div className="video_progress_bar__rail"  {...getRailProps()}>
            <div className="video_progress_bar__rail__buffer" style={bufferStyle} />
          </div>
        )}
      </Rail>
      <Handles>
        {({handles, getHandleProps}) => (
          <div>
            {handles.map(handle => (
              <Handle
                key={handle.id}
                handle={handle}
                domain={[0, 1]}
                getHandleProps={getHandleProps}
              />
            ))}
          </div>
        )}
      </Handles>
      <Tracks right={false}>
        {({tracks, getTrackProps}) => (
          <div>
            {tracks.map(({id, source, target}) => (
              <Track
                key={id}
                source={source}
                target={target}
                getTrackProps={getTrackProps}
              />
            ))}
          </div>
        )}
      </Tracks>
    </Slider>
  );
};

export default VideoProgressBar;
