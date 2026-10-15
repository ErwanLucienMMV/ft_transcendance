import { createValidationPipe } from './validation.js';
import { PaginationQueryDto } from './pagination.js';

describe('Pagination query validation', () => {
  const validate = (query: unknown) =>
    createValidationPipe().transform(query, {
      type: 'query',
      metatype: PaginationQueryDto,
    });
  it('supplies bounded defaults and converts HTTP integer strings', async () => {
    expect(await validate({})).toMatchObject({ limit: 20, offset: 0 });
    expect(await validate({ limit: '100', offset: '40' })).toMatchObject({
      limit: 100,
      offset: 40,
    });
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: '1.5' },
    { limit: 'abc' },
    { offset: -1 },
    { offset: '1.5' },
    { extra: 1 },
  ])('rejects invalid/unbounded pagination %j', async (query) => {
    await expect(validate(query)).rejects.toMatchObject({
      response: { statusCode: 400, code: 'VALIDATION_ERROR' },
    });
  });
});
