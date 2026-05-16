type MessageHandler = (msg: any) => void;
type StatusHandler = (username: string, online: boolean) => void;

let socket: WebSocket | null = null;
let messageHandlers: MessageHandler[] = [];
let statusHandlers: StatusHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWS(token: string) {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  socket = new WebSocket(url);

  socket.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "message" || data.type === "message_sent") {
      messageHandlers.forEach(h => h(data.payload));
    } else if (data.type === "user_online") {
      statusHandlers.forEach(h => h(data.username, true));
    } else if (data.type === "user_offline") {
      statusHandlers.forEach(h => h(data.username, false));
    }
  };

  socket.onclose = () => {
    reconnectTimer = setTimeout(() => connectWS(token), 3000);
  };
}

export function disconnectWS() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

export function sendWSMessage(payload: object) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "message", payload }));
  }
}

export function onMessage(h: MessageHandler) { 
  messageHandlers.push(h); 
  return () => { messageHandlers = messageHandlers.filter(x => x !== h); }; 
}

export function onStatusChange(h: StatusHandler) { 
  statusHandlers.push(h); 
  return () => { statusHandlers = statusHandlers.filter(x => x !== h); }; 
}