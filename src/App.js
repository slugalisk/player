import React, {Component} from 'react';
import URI from './ppspp/uri';
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
    this.props.ppsppClient.joinSwarm(uri);
  }

  onInputChange = e => {
    this.setState({swarmUri: e.target.value});
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
