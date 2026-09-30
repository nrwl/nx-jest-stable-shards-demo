const leaf = require('./test-01425.leaf');

test('test-01425', () => {
  const expected = 'test-01425';
  burn(3073);
  expect(leaf.value).toBe(expected);
});
