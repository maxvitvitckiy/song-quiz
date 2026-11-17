// Shared PeerJS setup for the online buzzer mode (host page and player page).
// Rooms use PeerJS's free public signaling server; once connected, phones talk
// straight to the host's browser over WebRTC. Each room code is its own peer id,
// so any number of groups can play at the same time.

const NET_PREFIX = "gts-room-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

function randomCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function cleanCode(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ?peer=host:port lets you point at your own PeerJS server (used for local testing).
function peerOptions() {
  const opts = { debug: 1 };
  const custom = new URLSearchParams(location.search).get("peer");
  if (custom) {
    const [host, port] = custom.split(":");
    Object.assign(opts, { host, port: Number(port) || 9000, path: "/", secure: location.protocol === "https:" && host !== "localhost" });
  }
  return opts;
}

function makePeer(id) {
  if (typeof Peer === "undefined") throw new Error("Couldn't load the online library. Check your connection and reload.");
  return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
}
