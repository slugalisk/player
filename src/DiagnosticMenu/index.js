import React, {Component} from 'react';
import classNames from 'classnames';

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
        key: 'minIncompleteBin',
        value: scheduler.lastCompletedBin,
      },
      {
        key: 'sendDelay',
        value: scheduler.sendDelay.value(),
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
        <td>{key}</td>
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
        <td>{key}</td>
        <td>{value}</td>
      </tr>
    ));

    return (
      <table>
        {rows}
      </table>
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
      table = <PeerStateTable value={this.props.value} />;
    }

    return (
      <div className="peer_state__container">
        <div className="peer_state__header">
          <ToggleButton
            onClick={this.handleButtonClick}
            expanded={this.state.expanded}
          />
          <h4 className="peer_state__title">{this.props.value.peer.localId}</h4>
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

    let swarmState;
    let peerStates;
    if (this.state.expanded) {
      swarmState = <SwarmState value={this.props.swarm} />

      peerStates = Object.entries(this.props.swarm.scheduler.peerStates).map(([key, peerState]) => (
        <PeerState key={key} value={peerState} />
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
