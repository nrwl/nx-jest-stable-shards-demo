const leaf = require('./test-01128.leaf');

test('test-01128', () => {
  const expected = 'test-01128';
  burn(1486);
  expect(leaf.value).toBe(expected);
});
