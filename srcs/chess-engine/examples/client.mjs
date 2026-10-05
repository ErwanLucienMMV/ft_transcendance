// Node >=22, no npm dependencies. CHESS_ENGINE_URL overrides the local endpoint.
const socket = new WebSocket(process.env.CHESS_ENGINE_URL ?? 'ws://127.0.0.1:8081');
const timer = setTimeout(() => {
  console.error('Engine timed out');
  process.exitCode = 1;
  socket.close();
}, 10000);
socket.addEventListener('open', () => socket.send(JSON.stringify({
  id: 'example-1', op: 'move', moves: ['e2e4', 'e7e5'], move: 'g1f3',
})));
socket.addEventListener('message', event => {
  clearTimeout(timer);
  console.log(JSON.stringify(JSON.parse(event.data), null, 2));
  socket.close();
});
socket.addEventListener('error', () => {
  clearTimeout(timer);
  console.error('Cannot connect to chess_engine');
  process.exitCode = 1;
});
socket.addEventListener('close', () => clearTimeout(timer));
