const leaf = require('./test-00030.leaf');

test('test-00030', () => {
  const expected = 'test-00030';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
