import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GetNotificationsQueryDto } from "./get-notifications-query.dto";

async function parseQuery(
  query: Record<string, string>,
): Promise<{ dto: GetNotificationsQueryDto; errorProperties: string[] }> {
  const dto = plainToInstance(GetNotificationsQueryDto, query);
  const errors = await validate(dto);
  return { dto, errorProperties: errors.map((error) => error.property) };
}

describe("GetNotificationsQueryDto unreadOnly (NOTIF-INBOX-01)", () => {
  it("defaults to false when the param is absent", async () => {
    const { dto, errorProperties } = await parseQuery({});

    expect(errorProperties).toEqual([]);
    expect(dto.unreadOnly).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("maps ?unreadOnly=%s to %s", async (raw, expected) => {
    const { dto, errorProperties } = await parseQuery({ unreadOnly: raw });

    expect(errorProperties).toEqual([]);
    expect(dto.unreadOnly).toBe(expected);
  });

  it.each(["yes", "1", "TRUE "])(
    "rejects ?unreadOnly=%s instead of reading it as false",
    async (raw) => {
      const { errorProperties } = await parseQuery({ unreadOnly: raw });

      expect(errorProperties).toEqual(["unreadOnly"]);
    },
  );
});
