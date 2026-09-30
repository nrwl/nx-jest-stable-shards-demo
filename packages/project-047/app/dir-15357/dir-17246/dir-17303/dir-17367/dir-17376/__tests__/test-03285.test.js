const leaf = require('./test-03285.leaf');

test('test-03285', () => {
  const expected = 'test-03285';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
