import React, {Component} from 'react';
import URI from './ppspp/uri';
import SwarmPlayer from './SwarmPlayer';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {swarmUri: props.swarmUri};
  }

  onJoinSubmit = e => {
    e.preventDefault();

    console.log(this.state.swarmUri);
    const uri = URI.parse(this.state.swarmUri);
    console.log('joining', uri);

    const swarm = this.props.ppsppClient.joinSwarm(uri);
    this.setState({swarm});
  }

  onInputChange = e => {
    this.setState({swarmUri: e.target.value});
  }

  render() {
    if (this.state.swarm) {
      return <SwarmPlayer swarm={this.state.swarm} />;
    }

    return (
      <React.Fragment>
        <div className="idle">
          <div className="scanner"></div>
          <div className="noise"></div>
        </div>
        <form className="join-form" onSubmit={this.onJoinSubmit}>
          <input
            onChange={this.onInputChange}
            placeholder="Enter Swarm URI"
            value={this.state.swarmUri}
          />
          <button>Join</button>
        </form>
      </React.Fragment>
    );
  }
}

export default App;
