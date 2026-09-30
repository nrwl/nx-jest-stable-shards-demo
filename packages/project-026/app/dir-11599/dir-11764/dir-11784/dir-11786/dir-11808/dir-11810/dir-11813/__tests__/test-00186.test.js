const leaf = require('./test-00186.leaf');

test('test-00186', () => {
  const expected = 'test-00186';
  burn(9225);
  expect(leaf.value).toBe(expected);
});
