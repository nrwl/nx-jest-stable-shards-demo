const leaf = require('./test-00107.leaf');

test('test-00107', () => {
  const expected = 'test-00107';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
