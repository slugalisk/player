import React, { Component } from 'react';
import SwarmId from './ppspp/swarmid';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);

    this.input = React.createRef();
  }

  onJoinSubmit = (e) => {
    // DTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABJITEKj0LLs5hOjmd9BGq2XCO5Mhyqx8XpU_-4E5SNqo3e4wiQfmTqvDys5l15juWljDtPAzd0y556gADZRuA0E

    e.preventDefault();

    console.log(this.input.current.value);
    const swarmId = SwarmId.from(Buffer.from(this.input.current.value, 'base64'));
    console.log('joining', swarmId);
    this.props.ppsppClient.joinSwarm(swarmId);
  }

  render() {
    return (
      <React.Fragment>
        <div className="idle">
          <div className="scanner"></div>
          <div className="noise"></div>
        </div>
        <form className="join-form" onSubmit={this.onJoinSubmit}>
          <input
            ref={this.input}
            placeholder="Enter Swarm ID"
          />
          <button>Join</button>
        </form>
      </React.Fragment>
    );
  }
}

export default App;
