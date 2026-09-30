const leaf = require('./test-01986.leaf');

test('test-01986', () => {
  const expected = 'test-01986';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
