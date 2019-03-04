import React, {useEffect, useReducer, useState} from 'react';
import {Server, ConnManager} from './loopback';
import {Client} from './client';
import arrayBufferToHex from 'array-buffer-to-hex';
import ForceGraph3D from 'react-force-graph-3d';
import {schemeCategory10} from 'd3-scale-chromatic';
import {scaleOrdinal} from 'd3-scale';
// import SpriteText from 'three-spritetext';
// import {Mesh, SphereBufferGeometry, MeshLambertMaterial} from 'three';

import './App.css';

const color = scaleOrdinal(schemeCategory10);

const reduceGraph = (graph, {type, ...data}) => {
  switch (type) {
    case 'ADD_NODE':
      return {
        nodes: [...graph.nodes, data],
        links: graph.links,
      };
    case 'REMOVE_NODE':
      return {
        nodes: graph.nodes.filter(node => node.id !== data.id),
        links: graph.links.filter(({source, target}) => {
          return source.id !== data.id && target.id !== data.id;
        }),
      };
    case 'ADD_LINK':
      return {
        nodes: graph.nodes,
        links: [...graph.links, {...data, activity: 0}],
      };
    case 'UPDATE_LINK':
      return {
        nodes: graph.nodes,
        links: graph.links.map((link) => {
          const {source, target} = link;
          if (source.id !== data.source || target.id !== data.target) {
            return link;
          }
          return {
            ...link,
            ...data,
          };
        }),
      };
    case 'INCR_LINK_ACTIVITY':
      return {
        nodes: graph.nodes,
        links: graph.links.map((link) => {
          const {source, target} = link;
          if (source.id !== data.source || target.id !== data.target) {
            return link;
          }
          return {
            ...link,
            activity: link.activity + 1,
          };
        }),
      };
    case 'DECR_LINK_ACTIVITY':
      return {
        nodes: graph.nodes,
        links: graph.links.map((link) => {
          const {source, target} = link;
          if (source.id !== data.source || target.id !== data.target) {
            return link;
          }
          return {
            ...link,
            activity: link.activity - 1,
          };
        }),
      };
    case 'REMOVE_LINK':
      console.log(data);
      return {
        nodes: graph.nodes,
        links: graph.links.filter(({source, target}) => {
          return source.id !== data.source || target.id !== data.target;
        }),
      };
    default:
      return graph;
  }
};

const useGraph = () => {
  const [server] = useState(new Server());
  const [gen, setGen] = useState(1);
  const [graph, dispatchGraphAction] = useReducer(reduceGraph, {nodes: [], links: []});

  useEffect(() => {
    const source = arrayBufferToHex(server.dhtClient.id);
    dispatchGraphAction({
      type: 'ADD_NODE',
      id: source,
      color: color(0),
      dhtClient: server.dhtClient,
    });
  }, []);

  const addNodes = (n = 1, props = {}) => {
    setGen(gen + 1);

    Promise.all(new Array(n).fill(0).map(() => Client.create(new ConnManager(server))))
      .then(clients => clients.forEach(({dhtClient}) => {
        // if (Math.random() > 0.5) {
        //   setTimeout(() => dhtClient.close(), Math.random() * 30000);
        // }

        const {id, allChannels} = dhtClient;
        console.log(allChannels);

        const source = arrayBufferToHex(id);
        dispatchGraphAction({
          type: 'ADD_NODE',
          id: source,
          color: color(gen),
          dhtClient,
          ...props,
        });
        dhtClient.on('close', () => dispatchGraphAction({
          type: 'REMOVE_NODE',
          id: source,
        }));

        allChannels.toArray().forEach(({id, conn}) => {
          if (conn != null) {
            dispatchGraphAction({
              type: 'ADD_LINK',
              source,
              target: arrayBufferToHex(id),
              color: conn ? '#fff' : '#66f',
            });
          }
        });

        // const registerConnObservers = (target, conn) => {
        //   const handleMessage = () => {
        //     dispatchGraphAction({type: 'INCR_LINK_ACTIVITY', source, target});
        //     setTimeout(() => dispatchGraphAction({type: 'DECR_LINK_ACTIVITY', source, target}), 10000);
        //   };

        //   conn.on('message', handleMessage);
        //   conn.remote.on('message', handleMessage);
        // };

        allChannels.on('added', ({id, conn}) => {
          if (conn != null) {
            const target = arrayBufferToHex(id);
            dispatchGraphAction({
              type: 'ADD_LINK',
              source,
              target,
              color: conn ? '#fff' : '#66f',
            });


            // registerConnObservers(target, conn);
          }
        });
        allChannels.on('updated', ({conn: oldConn}, {id, conn}) => {
          if (conn !== oldConn) {
            const target = arrayBufferToHex(id);
            // dispatchGraphAction({
            //   type: 'UPDATE_LINK',
            //   source,
            //   target,
            //   color: conn ? '#fff' : '#66f',
            // });

            dispatchGraphAction({
              type: 'ADD_LINK',
              source,
              target,
              color: conn ? '#fff' : '#66f',
            });


            // registerConnObservers(target, conn);
          }
        });
        allChannels.on('removed', ({id}) => dispatchGraphAction({
          type: 'REMOVE_LINK',
          source,
          target: arrayBufferToHex(id),
        }));
      }));
  };

  return [graph, {addNodes}];
};

const useNodePinger = () => {
  const [source, setSource] = useState(null);

  const handleNodeClick = node => {
    console.log(node);
    if (source === null) {
      setSource(node);
      console.log('set source', arrayBufferToHex(node.dhtClient.id));
      return;
    }

    console.log('pinging %s > %s', arrayBufferToHex(source.dhtClient.id), arrayBufferToHex(node.dhtClient.id))
    source.dhtClient.sendPing(node.dhtClient.id, (data) => {
      console.log('received ping response', data);
    });
    setSource(null);
  };

  return handleNodeClick;
};

const App = () => {
  const [graph, {addNodes}] = useGraph();
  const handleNodeClick = useNodePinger();

  console.log(graph);

  // useEffect(() => {
  //   let n = 1;
  //   const ivl = setInterval(() => {
  //     addNodes(1, {color: color(n)});
  //     if (++ n == 50) {
  //       clearInterval(ivl);
  //     }
  //   }, 1000);
  //   return () => clearInterval(ivl);
  // }, []);

  return (
    <div>
      <div className="graph-buttons">
        <button onClick={() => addNodes(1)}>add 1 peer</button>
        <button onClick={() => addNodes(5)}>add 5 peers</button>
        <button onClick={() => addNodes(10)}>add 10 peers</button>
      </div>
      <ForceGraph3D
        graphData={graph}
        nodeAutoColorBy="gen"
        onNodeClick={handleNodeClick}
        linkColor={link => link.color}
        linkWidth={1.5}
        nodeRelSize={2}
        nodeVal={node => node.dhtClient.allChannels.count()}
      />
    </div>
  );
};

export default App;
