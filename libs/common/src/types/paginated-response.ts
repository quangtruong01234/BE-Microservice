export class PaginatedResponse<T> {
  declare data: T[];
  declare total: number;
  declare page: number;
  declare limit: number;
  declare totalPages: number;
  declare hasNext: boolean;

  static of<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
  ): PaginatedResponse<T> {
    const totalPages = Math.ceil(total / limit) || 1;
    return { data, total, page, limit, totalPages, hasNext: page < totalPages };
  }
}
