import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { createTcpClientMock, TcpClientMock } from "@app/testing";
import { CHAT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { SessionRevocationService } from "../common/session/session-revocation.service";
import { ChatGatewayService } from "./chat.service";
import { ChatWsGateway } from "./chat.ws-gateway";

const CONVERSATION_ID = "conv_36a6838b81c611f1";
const MESSAGE_ID = "msg_36a6838b81c611f1";

describe("ChatWsGateway payload refs (SWEEP-1002-06)", () => {
  let chatClient: TcpClientMock;
  let client: {
    data: Record<string, unknown>;
    emit: jest.Mock;
    join: jest.Mock;
  };
  let roomEmit: jest.Mock;
  let gateway: ChatWsGateway;

  beforeEach(() => {
    chatClient = createTcpClientMock();
    client = { data: { userId: 7 }, emit: jest.fn(), join: jest.fn() };
    roomEmit = jest.fn();
    const chatService = {
      exposeMessage: jest.fn().mockResolvedValue({ id: MESSAGE_ID }),
    } as unknown as ChatGatewayService;
    gateway = new ChatWsGateway(
      {} as JwtService,
      chatClient.client,
      chatService,
      {} as SessionRevocationService,
    );
    gateway.server = {
      to: jest.fn(() => ({ emit: roomEmit })),
    } as unknown as Server;
  });

  const socket = (): Socket => client as unknown as Socket;

  it.each([
    ["no payload", undefined],
    ["no conversationId", {}],
    ["a numeric conversationId", { conversationId: 1 }],
    ["a malformed conversationId", { conversationId: "conv_short" }],
  ])("rejects join with %s before any TCP call", async (_label, payload) => {
    await gateway.handleJoin(
      socket(),
      payload as unknown as { conversationId: string },
    );

    expect(client.emit).toHaveBeenCalledWith(
      "error",
      "Invalid conversation id",
    );
    expect(chatClient.send).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it.each([
    ["no payload", undefined],
    ["no conversationId", { content: "hi" }],
    ["a numeric conversationId", { conversationId: 1, content: "hi" }],
  ])(
    "rejects send_message with %s before any TCP call",
    async (_label, payload) => {
      await gateway.handleSendMessage(
        socket(),
        payload as unknown as { conversationId: string; content: string },
      );

      expect(client.emit).toHaveBeenCalledWith(
        "error",
        "Invalid conversation id",
      );
      expect(chatClient.send).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed parentMessageId before any TCP call", async () => {
    await gateway.handleSendMessage(socket(), {
      conversationId: CONVERSATION_ID,
      content: "hi",
      parentMessageId: "42",
    });

    expect(client.emit).toHaveBeenCalledWith(
      "error",
      "Invalid parent message id",
    );
    expect(chatClient.send).not.toHaveBeenCalled();
  });

  it("joins the room for a member with a well-formed id", async () => {
    chatClient.replyTo(CHAT_MESSAGE_PATTERN.CHAT_CHECK_MEMBERSHIP, true);

    await gateway.handleJoin(socket(), { conversationId: CONVERSATION_ID });

    expect(client.join).toHaveBeenCalledWith(`conv:${CONVERSATION_ID}`);
    expect(client.emit).not.toHaveBeenCalled();
  });

  it("sends a null parentMessageId as no parent", async () => {
    chatClient.replyTo(CHAT_MESSAGE_PATTERN.CHAT_SEND_MESSAGE, {
      id: 1,
      participantIds: [7, 8],
    });

    await gateway.handleSendMessage(socket(), {
      conversationId: CONVERSATION_ID,
      content: "hi",
      parentMessageId: null,
    });

    expect(chatClient.send).toHaveBeenCalledWith(
      CHAT_MESSAGE_PATTERN.CHAT_SEND_MESSAGE,
      {
        userId: 7,
        dto: {
          conversationId: CONVERSATION_ID,
          content: "hi",
          parentMessageId: undefined,
        },
      },
    );
    expect(roomEmit).toHaveBeenCalledWith("new_message", { id: MESSAGE_ID });
    expect(client.emit).not.toHaveBeenCalled();
  });
});
