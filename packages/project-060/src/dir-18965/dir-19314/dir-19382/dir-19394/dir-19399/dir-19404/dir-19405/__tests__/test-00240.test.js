const leaf = require('./test-00240.leaf');

test('test-00240', () => {
  const expected = 'test-00240';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
