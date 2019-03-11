import React, {useEffect, useState, useReducer} from 'react';
import classNames from 'classnames';

import './PlayButton.scss';

const PlayButton = ({
  spin=false,
  flicker=false,
  pulse=false,
  disabled=false,
  visible=true,
  blur=false,
  onClick,
}) => {
  const [currentVisibility, setCurrentVisibility] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setCurrentVisibility(visible), 300);
    return () => clearTimeout(timeout);
  }, [visible]);

  const [hoverState, dispatchHoverAction] = useReducer((state, action) => {
    switch (action.type) {
      case 'ENTER':
        return {
          ...state,
          index: state.index + 1,
          hovering: true,
          show: false,
        };
      case 'LEAVE':
        return {
          ...state,
          hovering: false,
          show: false,
        };
      case 'TIMEOUT':
        return state.hovering && state.index === action.index
          ? {
            ...state,
            show: true,
          }
          : state;
      default:
        return state;
    }
  }, {index: 0});
  const handleMouseEnter = () => dispatchHoverAction({type: 'ENTER'});
  const handleMouseLeave = () => dispatchHoverAction({type: 'LEAVE'});

  useEffect(() => {
    if (hoverState.hovering) {
      const timeout = setTimeout(() => dispatchHoverAction({
        type: 'TIMEOUT',
        index: hoverState.index,
      }), 3000);
      return () => clearTimeout(timeout);
    }
  }, [hoverState]);

  const hoverClasses = classNames({
    play_button_wrap: true,
    hovering: hoverState.show,
    disabled,
  });

  const buttonClasses = classNames({
    play_button: true,
    clickable: onClick != null && !disabled,
    exiting: !visible && currentVisibility,
    hidden: !visible && !currentVisibility,
    spin,
    flicker,
    pulse,
    blur,
    disabled,
  });

  return (
    <div className={hoverClasses}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 927 927"
        className={buttonClasses}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <g className="background">
          <circle cx="463" cy="463" r="463"/>
        </g>
        <g className="network">
          <circle cx="327" cy="229" r="139"/>
          <circle cx="732" cy="463" r="139"/>
          <circle cx="327" cy="697" r="139"/>
          <polygon points="854 463 269 125 269 801 854 463"/>
        </g>
        <g className="button">
          <path d="M658,524c23-13,23-36,0-50L457,358c-23-13-43-2-43,25V616c0,27,19,38,43,25Z" transform="translate(-45 -36)"/>
        </g>
    </svg>
    </div>

  );
};

export default PlayButton;
