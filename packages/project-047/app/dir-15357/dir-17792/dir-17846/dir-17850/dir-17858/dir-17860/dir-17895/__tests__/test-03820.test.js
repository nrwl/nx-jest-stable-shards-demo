const leaf = require('./test-03820.leaf');

test('test-03820', () => {
  const expected = 'test-03820';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
