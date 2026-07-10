const { createStore } = require("zustand/vanilla");
const { useStore } = require("zustand");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const store = createStore((set) => ({
  room: {
    playlist: Array.from({ length: 500 }, (_, i) => ({ id: i.toString(), val: i })),
    playback: { time: 0 },
  },
  participantId: "123",
  sendCommand: () => {}
}));

const { useShallow } = require("zustand/react/shallow");

function ComponentShallow() {
  const { room, participantId, sendCommand } = useStore(store, useShallow((s) => ({ room: s.room, participantId: s.participantId, sendCommand: s.sendCommand })));
  return React.createElement("div", null, room.playlist.length);
}

function ComponentGranular() {
  const room = useStore(store, (s) => s.room);
  const participantId = useStore(store, (s) => s.participantId);
  const sendCommand = useStore(store, (s) => s.sendCommand);
  return React.createElement("div", null, room.playlist.length);
}


let renderCountShallow = 0;
let renderCountGranular = 0;

// Need to test re-rendering actually, we can simulate by checking equality function...
