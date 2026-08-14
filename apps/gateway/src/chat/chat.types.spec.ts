import { chatMessageRooms } from "./chat.types";

describe("chatMessageRooms (CHAT-ROOM-01)", () => {
  it("targets both participants' user rooms plus the conversation room", () => {
    expect(chatMessageRooms([7, 12], "conv_abc123")).toEqual([
      "user:7",
      "user:12",
      "conv:conv_abc123",
    ]);
  });

  it("falls back to the conversation room when the chat service sends no participants", () => {
    expect(chatMessageRooms(undefined, "conv_abc123")).toEqual([
      "conv:conv_abc123",
    ]);
    expect(chatMessageRooms([], "conv_abc123")).toEqual(["conv:conv_abc123"]);
  });

  it("dedupes repeated ids and drops falsy ones", () => {
    expect(chatMessageRooms([7, 7, 0], "conv_abc123")).toEqual([
      "user:7",
      "conv:conv_abc123",
    ]);
  });

  it("normalizes ids that arrive as strings over TCP", () => {
    expect(
      chatMessageRooms(["7", 12] as unknown as number[], "conv_abc123"),
    ).toEqual(["user:7", "user:12", "conv:conv_abc123"]);
  });
});
