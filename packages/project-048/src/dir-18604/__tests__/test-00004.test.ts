const leaf = require('./test-00004.leaf');

test('test-00004', () => {
  const expected: string = 'test-00004';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
