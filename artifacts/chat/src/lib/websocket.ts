type MessageHandler = (msg: any) => void;
type StatusHandler = (username: string, online: boolean) => void;
type DeliveredHandler = (messageId: number) => void;
type ReadHandler = (messageIds: number[]) => void;

let socket: WebSocket | null = null;
let messageHandlers: MessageHandler[] = [];
let statusHandlers: StatusHandler[] = [];
let deliveredHandlers: DeliveredHandler[] = [];
let readHandlers: ReadHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWS(token: string) {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  
  let url: string;
  const savedApiUrl = localStorage.getItem("securechat_api_url");
  const apiUrl = savedApiUrl || import.meta.env.VITE_API_URL;
  if (apiUrl && apiUrl.startsWith("http")) {
    const parsed = new URL(apiUrl);
    const wsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
    url = `${wsProto}//${parsed.host}/ws?token=${encodeURIComponent(token)}`;
  } else {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  }

  socket = new WebSocket(url);

  socket.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "message" || data.type === "message_sent") {
      messageHandlers.forEach(h => h(data.payload));
    } else if (data.type === "user_online") {
      statusHandlers.forEach(h => h(data.username, true));
    } else if (data.type === "user_offline") {
      statusHandlers.forEach(h => h(data.username, false));
    } else if (data.type === "message_delivered") {
      // Server tells sender: recipient received the message
      deliveredHandlers.forEach(h => h(data.payload.id as number));
    } else if (data.type === "message_read") {
      // Server tells sender: recipient has read the messages
      readHandlers.forEach(h => h(data.payload.ids as number[]));
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

/** Notify server that we have read all messages from a given sender. */
export function sendReadReceipt(fromUsername: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "read_receipt", payload: { fromUsername } }));
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

export function onDelivered(h: DeliveredHandler) {
  deliveredHandlers.push(h);
  return () => { deliveredHandlers = deliveredHandlers.filter(x => x !== h); };
}

export function onRead(h: ReadHandler) {
  readHandlers.push(h);
  return () => { readHandlers = readHandlers.filter(x => x !== h); };
}