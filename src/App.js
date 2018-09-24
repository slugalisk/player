import React, { Component } from 'react';
import URI from './ppspp/uri';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);

    this.input = React.createRef();
  }

  onJoinSubmit = (e) => {
    e.preventDefault();

    console.log(this.input.current.value);
    const uri = URI.parse(this.input.current.value);
    console.log('joining', uri);
    this.props.ppsppClient.joinSwarm(uri);
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
