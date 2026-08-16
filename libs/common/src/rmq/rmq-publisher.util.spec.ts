import { Channel } from "amqplib";
import { isRmqPublisherLive } from "./rmq-publisher.util";

describe("isRmqPublisherLive (OUTBOX-SCOPE-01)", () => {
  it("is false when the factory returned no channel at all", () => {
    expect(isRmqPublisherLive(null)).toBe(false);
    expect(isRmqPublisherLive(undefined)).toBe(false);
  });

  it("is false for the self-healing proxy during a broker outage", () => {
    // The proxy stays truthy and keeps answering publish() with a no-op — only
    // the missing `connection` betrays that nothing is actually being sent.
    const offlineProxy = {
      publish: () => false,
      connection: undefined,
    } as unknown as Channel;
    expect(offlineProxy).toBeTruthy();
    expect(isRmqPublisherLive(offlineProxy)).toBe(false);
  });

  it("is true for a connected channel", () => {
    const liveChannel = {
      publish: () => true,
      connection: {},
    } as unknown as Channel;
    expect(isRmqPublisherLive(liveChannel)).toBe(true);
  });
});
