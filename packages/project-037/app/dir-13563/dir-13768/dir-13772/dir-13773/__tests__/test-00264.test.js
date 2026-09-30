const leaf = require('./test-00264.leaf');

test('test-00264', () => {
  const expected = 'test-00264';
  burn(9467);
  expect(leaf.value).toBe(expected);
});
