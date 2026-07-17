import { io } from "socket.io-client";

const BASE_URL = "http://localhost:3000";
const WS_URL = "http://localhost:3000";
// PUBID-03: conversations are addressed by opaque public id (conv_...).
const CONVERSATION_ID = process.argv[2] ?? "conv_36a6838b81c611f1";
const USER_A_USERNAME = process.env.CHAT_USER_A_USERNAME;
const USER_A_PASSWORD = process.env.CHAT_USER_A_PASSWORD;
const USER_B_USERNAME = process.env.CHAT_USER_B_USERNAME;
const USER_B_PASSWORD = process.env.CHAT_USER_B_PASSWORD;

if (
  !USER_A_USERNAME ||
  !USER_A_PASSWORD ||
  !USER_B_USERNAME ||
  !USER_B_PASSWORD
) {
  throw new Error("Chat test account environment variables are required");
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await res.json();
  // Extract JWT from Set-Cookie header
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/access_token=([^;]+)/);
  if (!match) throw new Error(`No access_token cookie for ${username}`);
  return decodeURIComponent(match[1]);
}

function connect(token) {
  return io(`${WS_URL}/chat`, {
    auth: { token },
    transports: ["websocket"],
  });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for '${event}'`)),
      timeoutMs,
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 5000);
  });
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function run() {
  console.log("=== Chat WebSocket Test ===\n");

  // Step 1: Login both users
  let token17, token18;
  try {
    token17 = await login(USER_A_USERNAME, USER_A_PASSWORD);
    check("Login user 17", true, "token acquired");
  } catch (e) {
    check("Login user 17", false, e.message);
    process.exit(1);
  }
  try {
    token18 = await login(USER_B_USERNAME, USER_B_PASSWORD);
    check("Login user 18", true, "token acquired");
  } catch (e) {
    check("Login user 18", false, e.message);
    process.exit(1);
  }

  // Step 2: Connect both sockets
  const client17 = connect(token17);
  const client18 = connect(token18);

  try {
    await Promise.all([waitForConnect(client17), waitForConnect(client18)]);
    check("Connect user 17 to WS", true);
    check("Connect user 18 to WS", true);
  } catch (e) {
    check("Connect both clients", false, e.message);
    client17.disconnect();
    client18.disconnect();
    process.exit(1);
  }

  // Step 3: Both join the conversation
  client17.emit("join", { conversationId: CONVERSATION_ID });
  client18.emit("join", { conversationId: CONVERSATION_ID });
  await new Promise((r) => setTimeout(r, 300));
  check("Emit join (both clients)", true, `conversationId=${CONVERSATION_ID}`);

  // Step 4: client18 listens, client17 sends
  const messagePromise = waitForEvent(client18, "new_message");
  client17.emit("send_message", {
    conversationId: CONVERSATION_ID,
    content: "Hello from WS test",
  });

  try {
    const msg = await messagePromise;
    check(
      "Client 18 receives new_message",
      msg.content === "Hello from WS test",
      `content="${msg.content}"`,
    );
    check(
      "Message senderId is an opaque usr_ public id",
      typeof msg.senderId === "string" &&
        /^usr_[0-9A-Za-z]{16}$/.test(msg.senderId),
      `senderId=${msg.senderId}`,
    );
    check(
      "Message conversationId correct",
      msg.conversationId === CONVERSATION_ID,
      `conversationId=${msg.conversationId}`,
    );
    check(
      "Message id is an opaque msg_ public id",
      typeof msg.id === "string" && /^msg_[0-9A-Za-z]{16}$/.test(msg.id),
      `id=${msg.id}`,
    );
  } catch (e) {
    check("Client 18 receives new_message", false, e.message);
  }

  // Disconnect
  client17.disconnect();
  client18.disconnect();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
