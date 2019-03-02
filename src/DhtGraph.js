import React, {useEffect, useReducer, useState} from 'react';
import {Server, ConnManager} from './loopback';
import {Client} from './client';
import arrayBufferToHex from 'array-buffer-to-hex';
import {ForceGraph3D} from 'react-force-graph';
import {schemeCategory10} from 'd3-scale-chromatic';
import {scaleOrdinal} from 'd3-scale';

import './App.css';

const color = scaleOrdinal(schemeCategory10);

const reduceGraph = (graph, {type, ...data}) => {
  switch (type) {
    case 'ADD_NODE':
      return {
        nodes: [...graph.nodes, data],
        links: graph.links,
      };
    case 'ADD_LINK':
      return {
        nodes: graph.nodes,
        links: [...graph.links, data],
      };
    case 'REMOVE_LINK':
      return {
        nodes: graph.nodes,
        links: graph.links.filter(({source, target}) => {
          return source !== data.source || target !== data.target;
        }),
      };
  }
  return graph;
};

const App = () => {
  const [server] = useState(new Server());
  const [gen, setGen] = useState(1);
  const [graph, dispatchGraphAction] = useReducer(reduceGraph, {nodes: [], links: []});

  useEffect(() => {
    const source = arrayBufferToHex(server.dhtClient.id);
    dispatchGraphAction({
      type: 'ADD_NODE',
      id: source,
      color: color(0),
    });
  }, []);

  const handleAddPeerClick = (n=1) => {
    setGen(gen + 1);

    Promise.all(new Array(n).fill(0).map(() => Client.create(new ConnManager(server))))
      .then(clients => clients.forEach(({dhtClient: {id, channels}}) => {
        const source = arrayBufferToHex(id);
        dispatchGraphAction({
          type: 'ADD_NODE',
          id: source,
          color: color(gen),
        });

        channels.on('added', ({id}) => dispatchGraphAction({
          type: 'ADD_LINK',
          source,
          target: arrayBufferToHex(id),
        }));
        channels.on('removed', ({id}) => dispatchGraphAction({
          type: 'REMOVE_LINK',
          source,
          target: arrayBufferToHex(id),
        }));
      }));
  };

  return (
    <div>
      <div className="graph-buttons">
        <button onClick={() => handleAddPeerClick(1)}>add 1 peer</button>
        <button onClick={() => handleAddPeerClick(5)}>add 5 peers</button>
        <button onClick={() => handleAddPeerClick(10)}>add 10 peers</button>
        <button onClick={() => handleAddPeerClick(50)}>add 50 peers</button>
      </div>
      <ForceGraph3D
        graphData={graph}
        nodeAutoColorBy="gen"
      />
    </div>
  );
};

export default App;
