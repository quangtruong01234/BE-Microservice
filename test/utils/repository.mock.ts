import { ObjectLiteral, Repository } from "typeorm";

/** Every method below is a `jest.Mock`; the rest of `Repository<T>` is absent. */
export type RepositoryMock<T extends ObjectLiteral> = {
  [K in RepositoryMethod]: jest.Mock;
} & {
  /** Pass to `useValue` or a constructor where `Repository<T>` is expected. */
  asRepository: () => Repository<T>;
};

type RepositoryMethod =
  | "create"
  | "save"
  | "insert"
  | "update"
  | "upsert"
  | "delete"
  | "softDelete"
  | "remove"
  | "find"
  | "findBy"
  | "findOne"
  | "findOneBy"
  | "findAndCount"
  | "count"
  | "exists"
  | "increment"
  | "decrement"
  | "query"
  | "createQueryBuilder";

/**
 * A TypeORM `Repository<T>` stand-in with the commonly used methods mocked.
 *
 * Defaults are the "nothing there" answers — `findOne` → null, `find` → [],
 * `findAndCount` → [[], 0], `count` → 0 — so a spec only stubs what its case
 * needs. `create` echoes its input and `save` resolves its input, which is
 * enough for most write paths; override either when the case depends on a
 * generated id. `createQueryBuilder` returns a chainable builder whose terminal
 * calls (`getOne`, `getMany`, `getManyAndCount`, `getRawMany`, `execute`) are
 * mocks too — reach them via `repo.createQueryBuilder().getMany`.
 *
 *   { provide: getRepositoryToken(User), useValue: userRepo.asRepository() }
 */
export function createRepositoryMock<
  T extends ObjectLiteral,
>(): RepositoryMock<T> {
  const queryBuilder: Record<string, jest.Mock> = {};
  const chainable = [
    "select",
    "addSelect",
    "where",
    "andWhere",
    "orWhere",
    "leftJoin",
    "leftJoinAndSelect",
    "innerJoin",
    "innerJoinAndSelect",
    "orderBy",
    "addOrderBy",
    "groupBy",
    "skip",
    "take",
    "limit",
    "offset",
    "setParameter",
    "setParameters",
    "update",
    "set",
    "insert",
    "into",
    "values",
    "orIgnore",
    "delete",
    "from",
  ];
  for (const method of chainable) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }
  queryBuilder.getOne = jest.fn().mockResolvedValue(null);
  queryBuilder.getMany = jest.fn().mockResolvedValue([]);
  queryBuilder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  queryBuilder.getRawOne = jest.fn().mockResolvedValue(undefined);
  queryBuilder.getRawMany = jest.fn().mockResolvedValue([]);
  queryBuilder.getCount = jest.fn().mockResolvedValue(0);
  queryBuilder.execute = jest.fn().mockResolvedValue({ affected: 0 });

  const repository = {
    create: jest.fn((entityLike: unknown) => entityLike),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    insert: jest.fn().mockResolvedValue({ identifiers: [], raw: [] }),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    upsert: jest.fn().mockResolvedValue({ identifiers: [], raw: [] }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 0 }),
    remove: jest.fn((entity: unknown) => Promise.resolve(entity)),
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(false),
    increment: jest.fn().mockResolvedValue({ affected: 0 }),
    decrement: jest.fn().mockResolvedValue({ affected: 0 }),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  return {
    ...repository,
    asRepository: (): Repository<T> => repository as unknown as Repository<T>,
  };
}
