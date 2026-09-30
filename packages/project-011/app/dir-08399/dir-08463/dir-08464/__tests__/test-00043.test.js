const leaf = require('./test-00043.leaf');

test('test-00043', () => {
  const expected = 'test-00043';
  burn(27108);
  expect(leaf.value).toBe(expected);
});
