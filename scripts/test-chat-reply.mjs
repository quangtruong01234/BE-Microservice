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
  console.log("=== Chat Reply Test ===\n");

  // Step 1: Login
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

  // Step 2: Connect + join
  const client17 = connect(token17);
  const client18 = connect(token18);

  try {
    await Promise.all([waitForConnect(client17), waitForConnect(client18)]);
    check("Connect both clients", true);
  } catch (e) {
    check("Connect both clients", false, e.message);
    client17.disconnect();
    client18.disconnect();
    process.exit(1);
  }

  client17.emit("join", { conversationId: CONVERSATION_ID });
  client18.emit("join", { conversationId: CONVERSATION_ID });
  await new Promise((r) => setTimeout(r, 300));

  // Step 3: Send original message, capture messageId
  let originalMessageId;
  const originalPromise = waitForEvent(client18, "new_message");
  client17.emit("send_message", {
    conversationId: CONVERSATION_ID,
    content: "Original message",
  });

  try {
    const msg = await originalPromise;
    originalMessageId = msg.id;
    check(
      "Original message received by client 18",
      msg.content === "Original message",
      `content="${msg.content}"`,
    );
    check(
      "Original message parentMessageId is null",
      msg.parentMessageId === null,
      `parentMessageId=${msg.parentMessageId}`,
    );
    check(
      "Original messageId is an opaque msg_ public id",
      typeof originalMessageId === "string" &&
        /^msg_[0-9A-Za-z]{16}$/.test(originalMessageId),
      `messageId=${originalMessageId}`,
    );
  } catch (e) {
    check("Original message received by client 18", false, e.message);
    client17.disconnect();
    client18.disconnect();
    process.exit(1);
  }

  // Step 4: Send reply with parentMessageId
  const replyPromise = waitForEvent(client18, "new_message");
  client17.emit("send_message", {
    conversationId: CONVERSATION_ID,
    content: "Reply to original",
    parentMessageId: originalMessageId,
  });

  try {
    const reply = await replyPromise;
    check(
      "Reply received by client 18",
      reply.content === "Reply to original",
      `content="${reply.content}"`,
    );
    // PUBID-03: parentMessageId is the parent's opaque msg_ public id
    check(
      "Reply parentMessageId matches original messageId",
      reply.parentMessageId === originalMessageId,
      `parentMessageId=${reply.parentMessageId} (expected ${originalMessageId})`,
    );
    check(
      "Reply senderId is an opaque usr_ public id",
      typeof reply.senderId === "string" &&
        /^usr_[0-9A-Za-z]{16}$/.test(reply.senderId),
      `senderId=${reply.senderId}`,
    );
  } catch (e) {
    check("Reply received by client 18", false, e.message);
  }

  // Step 4b: invalid parent (unknown msg_ id) must be rejected with an error
  const invalidParentPromise = waitForEvent(client17, "error", 5000);
  client17.emit("send_message", {
    conversationId: CONVERSATION_ID,
    content: "Reply to nonexistent parent",
    parentMessageId: "msg_0000000000000000",
  });
  try {
    const errMsg = await invalidParentPromise;
    check(
      "Invalid parentMessageId rejected with error event",
      typeof errMsg === "string" && errMsg.length > 0,
      `error="${errMsg}"`,
    );
  } catch (e) {
    check(
      "Invalid parentMessageId rejected with error event",
      false,
      e.message,
    );
  }

  client17.disconnect();
  client18.disconnect();

  // Step 5: HTTP verify
  console.log("\n--- HTTP verify: GET /conversations/1/messages ---");
  try {
    const res = await fetch(
      `${BASE_URL}/api/chat/conversations/${CONVERSATION_ID}/messages`,
      { headers: { Cookie: `access_token=${token17}` } },
    );
    const body = await res.json();
    const messages = body?.data?.data ?? [];
    check(
      "GET messages returns array",
      Array.isArray(messages) && messages.length > 0,
      `count=${messages.length}`,
    );
    const reply = messages.find((m) => m.parentMessageId !== null);
    const original = messages.find((m) => m.parentMessageId === null);
    check(
      "Reply message has non-null parentMessageId",
      reply != null,
      reply
        ? `id=${reply.id} parentMessageId=${reply.parentMessageId}`
        : "not found",
    );
    check(
      "Original message has null parentMessageId",
      original != null,
      original
        ? `id=${original.id} parentMessageId=${original.parentMessageId}`
        : "not found",
    );
    if (reply && original) {
      check(
        "Reply.parentMessageId is an existing message's msg_ id",
        typeof reply.parentMessageId === "string" &&
          messages.some((m) => m.id === reply.parentMessageId),
        `parentMessageId=${reply.parentMessageId}`,
      );
    }
    console.log("\n  Message dump:");
    for (const m of messages) {
      console.log(
        `    id=${m.id}  content="${m.content}"  parentMessageId=${m.parentMessageId}`,
      );
    }
  } catch (e) {
    check("GET messages HTTP check", false, e.message);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
