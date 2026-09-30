const leaf = require('./test-00002.leaf');

test('test-00002', () => {
  const expected: string = 'test-00002';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
