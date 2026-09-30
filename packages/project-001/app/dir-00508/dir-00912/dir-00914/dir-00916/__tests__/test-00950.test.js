const leaf = require('./test-00950.leaf');

test('test-00950', () => {
  const expected = 'test-00950';
  burn(24755);
  expect(leaf.value).toBe(expected);
});
