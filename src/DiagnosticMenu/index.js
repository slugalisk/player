import React, {Component} from 'react';
import classNames from 'classnames';
import {scaleLinear} from 'd3-scale';

import './index.css';

class ToggleButton extends Component {
  static defaultProps = {
    expanded: false,
  };

  render() {
    const buttonClasses = classNames({
      'diagnostic_menu__toggle_button': true,
      'diagnostic_menu__toggle_button--expanded': this.props.expanded,
    });

    return (
      <button
        onClick={this.props.onClick}
        className={buttonClasses}
      />
    );
  }
}

class SwarmState extends Component {
  render() {
    const {scheduler} = this.props.value;

    const values = [
      {
        key: 'totalSends',
        value: scheduler.totalSends,
      },
      {
        key: 'totalRequests',
        value: scheduler.totalRequests,
      },
      {
        key: 'totalRequestsReceived',
        value: scheduler.totalRequestsReceived,
      },
      {
        key: 'totalDroppedRequests',
        value: scheduler.totalDroppedRequests,
      },
      {
        key: 'totalReceived',
        value: scheduler.totalReceived,
      },
      {
        key: 'totalAdded',
        value: scheduler.totalAdded,
      },
      {
        key: 'totalCancelled',
        value: scheduler.totalCancelled,
      },
      {
        key: 'ackUnknownSend',
        value: scheduler.ackUnknownSend,
      },
      {
        key: 'lastCompletedBin',
        value: scheduler.lastCompletedBin,
      },
      {
        key: 'picker.firstLoadedChunk',
        value: scheduler.loadedChunks.min(),
      },
      {
        key: 'picker.firstRequestedChunk',
        value: scheduler.requestedChunks.min(),
      },
      {
        key: 'chunkRate',
        value: scheduler.chunkRate.value(),
      },
    ];

    const rows = values.map(({key, value}) => (
      <tr key={key}>
        <td className="diagnostic_table__key_cell">{key}</td>
        <td>{value}</td>
      </tr>
    ));

    return (
      <div className="swarm_state__container">
        <table>
          {rows}
        </table>
      </div>
    );
  }
}

class PeerStateTable extends Component {
  render() {
    const peerState = this.props.value;

    const values = [
      {
        key: 'chunkIntervalMean',
        value: peerState.chunkIntervalMean.value(),
      },
      {
        key: 'wasteRate',
        value: peerState.wasteRate.value(),
      },
      {
        key: 'chunkRate',
        value: peerState.chunkRate.value(),
      },
      {
        key: 'ledbat.baseDelay',
        value: peerState.ledbat.baseDelay.getMin(),
      },
      {
        key: 'ledbat.currentDelay',
        value: peerState.ledbat.currentDelay.getMin(),
      },
      {
        key: 'ledbat.rttMean',
        value: peerState.ledbat.rttMean.value(),
      },
      {
        key: 'ledbat.rttVar',
        value: peerState.ledbat.rttVar.value(),
      },
      {
        key: 'ledbat.cwnd',
        value: peerState.ledbat.cwnd,
      },
      {
        key: 'ledbat.cto',
        value: peerState.ledbat.cto,
      },
      {
        key: 'ledbat.flightSize',
        value: peerState.ledbat.flightSize,
      },
      {
        key: 'validChunks',
        value: peerState.validChunks,
      },
      {
        key: 'requestQueue.length',
        value: peerState.requestQueue.length,
      },
      {
        key: 'requestedChunks.length',
        value: peerState.requestedChunks.length,
      },
    ];

    const rows = values.map(({key, value}) => (
      <tr key={key}>
        <td className="diagnostic_table__key_cell">{key}</td>
        <td>{value}</td>
      </tr>
    ));

    const {
      startBin,
      endBin,
    } = this.props;

    rows.push(
      <tr key="availableChunks">
        <td colSpan="2">
          Available
          <AvailabilityMapChart
            value={this.props.value.availableChunks}
            startBin={startBin}
            endBin={endBin}
          />
        </td>
      </tr>
    );

    rows.push(
      <tr key="sentChunks">
        <td colSpan="2">
          Sent
          <AvailabilityMapChart
            value={this.props.value.sentChunks}
            startBin={startBin}
            endBin={endBin}
          />
        </td>
      </tr>
    );

    rows.push(
      <tr key="receivedChunks">
        <td colSpan="2">
          Received
          <AvailabilityMapChart
            value={this.props.value.receivedChunks}
            startBin={startBin}
            endBin={endBin}
          />
        </td>
      </tr>
    );

    return (
      <table>
        <tbody>
          {rows}
        </tbody>
      </table>
    );
  }
}

class AvailabilityMapChart extends Component {
  constructor(props) {
    super(props);

    this.canvas = React.createRef();
  }

  componentDidUpdate() {
    if (!this.canvas.current) {
      return;
    }

    const {value} = this.props;
    const min = isNaN(this.props.startBin)
      ? value.min()
      : this.props.startBin;
    const max = isNaN(this.props.endBin)
      ? value.max()
      : this.props.endBin;

    if (!isFinite(min) || !isFinite(max) || isNaN(min) || isNaN(max)) {
      return;
    }

    const ctx = this.canvas.current.getContext('2d');
    const width = 500;
    const height = 20;

    const scale = scaleLinear()
      .domain([min, max])
      .range([0, width]);

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ccc';

    let lastStart = -1;
    for (let i = min; i <= max; i += 2) {
      if (!value.values.get((i + 2) / 2) || i === max) {
        if (lastStart !== -1) {
          ctx.fillRect(scale(lastStart), 0, scale(i) - scale(lastStart), 20);

          lastStart = -1;
        }
      } else if (lastStart === -1) {
        lastStart = i;
      }
    }
  }

  render() {
    return (
      <canvas
        height="20"
        width="500"
        ref={this.canvas}
      />
    );
  }
}

class PeerState extends Component {
  constructor(props) {
    super(props);

    this.state = {
      expanded: false,
    };
  }

  handleButtonClick = () => {
    this.setState({expanded: !this.state.expanded});
  }

  render() {
    let table;
    if (this.state.expanded) {
      table = (
        <PeerStateTable
          value={this.props.value}
          startBin={this.props.startBin}
          endBin={this.props.endBin}
        />
      );
    }

    return (
      <div className="peer_state__container">
        <div className="peer_state__header">
          <ToggleButton
            onClick={this.handleButtonClick}
            expanded={this.state.expanded}
          />
          <h4 className="peer_state__title">
            {this.props.value.peer.localId} : {this.props.value.peer.remoteId}
          </h4>
        </div>
        {table}
      </div>
    );
  }
}

class DiagnosticMenu extends Component {
  constructor(props) {
    super(props);

    this.state = {
      expanded: false,
    };

    console.log(this.props.swarm);
  }

  handleButtonClick = () => {
    this.setState({expanded: !this.state.expanded});

    this.scheduleUpdate();
  }

  handleUpdate = () => {
    if (this.state.expanded) {
      this.forceUpdate(this.scheduleUpdate);
    }
  }

  scheduleUpdate = () => {
    window.requestAnimationFrame(this.handleUpdate);
  }

  render() {
    const containerClasses = classNames({
      'diagnostic_menu__container': true,
      'diagnostic_menu__container--expanded': this.state.expanded,
    });

    const {
      lastCompletedBin,
      liveDiscardWindow,
    } = this.props.swarm.scheduler;
    const startBin = lastCompletedBin - liveDiscardWindow;
    const endBin = lastCompletedBin + liveDiscardWindow;

    let swarmState;
    let peerStates;
    if (this.state.expanded) {
      swarmState = (
        <SwarmState
          value={this.props.swarm}
          startBin={startBin}
          endBin={endBin}
        />
      );

      peerStates = Object.entries(this.props.swarm.scheduler.peerStates).map(([key, peerState]) => (
        <PeerState
          key={key}
          value={peerState}
          startBin={startBin}
          endBin={endBin}
        />
      ));
    }

    return (
      <div className={containerClasses}>
        <ToggleButton
          onClick={this.handleButtonClick}
          expanded={this.state.expanded}
        />
        {swarmState}
        {peerStates}
      </div>
    );
  }
}

export default DiagnosticMenu;
