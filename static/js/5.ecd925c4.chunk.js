((self||this).webpackJsonp=(self||this).webpackJsonp||[]).push([[5],{5807:function(e,t){},5809:function(e,t){},5827:function(e,t,a){},5833:function(e,t,a){"use strict";a.r(t);var n=a(50),r=a.n(n),c=a(127),i=a(4),u=a(0),o=a.n(u),s=a(133),l=a(176),m=a(31),d=a(59),v=a(136),f=a(134),p=a(132),b=a(1),w=a(10),g=a(131),S=a(5803),h=a.n(S);a(240),a(5827);t.default=function(e){var t=Object(m.useAsync)(function(){return s.a.create(new l.a(Object(v.b)()))},[]).value,a=Object(v.c)(t),n=Object(i.a)(a,2),S=n[0],j=n[1],E=Object(u.useState)(null),O=Object(i.a)(E,2),y=O[0],D=O[1],_=Object(u.useState)(""),k=Object(i.a)(_,2),R=k[0],A=k[1],M=S||y,x=Object(u.useRef)();if(Object(d.a)(function(){var e=new p.b(M),t=h.a.DecodedStream({mimeType:'video/webm; codecs="vp8"',videoElement:x.current});e.on("data",function(e){t.write(w.Buffer.concat(e.chunks,e.length))})},[x,M]),M)return o.a.createElement("div",{className:"media_device_test__player"},o.a.createElement("video",{controls:!0,autoPlay:!0,ref:x}),o.a.createElement(g.a,{swarm:M}),o.a.createElement("input",{defaultValue:M.uri.toString()}));var C=function(){var e=Object(c.a)(r.a.mark(function e(a){var n,c,i,u;return r.a.wrap(function(e){for(;;)switch(e.prev=e.next){case 0:return a.preventDefault(),n=navigator.mediaDevices.getDisplayMedia?navigator.mediaDevices.getDisplayMedia({video:!0,frameRate:30}):navigator.mediaDevices.getUserMedia({video:{mediaSource:"screen"},frameRate:30}),e.t0=h.a,e.next=5,n;case 5:return e.t1=e.sent,e.t2={mimeType:'video/webm; codecs="vp8"'},c=e.t0.EncodedStream.call(e.t0,e.t1,e.t2),e.next=10,f.a.create({chunkSize:32768,chunksPerSignature:16,liveSignatureAlgorithm:b.c.RSASHA1});case 10:i=e.sent,u=new p.c(i),c.on("data",function(e){return u.write(e)}),D(i.swarm),t.ppsppClient.publishSwarm(i.swarm);case 15:case"end":return e.stop()}},e)}));return function(t){return e.apply(this,arguments)}}(),J=navigator.mediaDevices.getDisplayMedia&&o.a.createElement("button",{onClick:C},"Stream");return o.a.createElement("form",{className:"media_device_test__form",onSubmit:function(){return j(R)}},o.a.createElement("input",{onChange:function(e){return A(e.target.value)},placeholder:"Enter Swarm URI",value:R}),o.a.createElement("button",null,"Join"),J)}}}]);
//# sourceMappingURL=5.ecd925c4.chunk.js.map