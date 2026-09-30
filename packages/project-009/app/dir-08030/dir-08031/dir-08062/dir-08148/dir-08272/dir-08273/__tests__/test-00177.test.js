const leaf = require('./test-00177.leaf');

test('test-00177', () => {
  const expected = 'test-00177';
  burn(2108);
  expect(leaf.value).toBe(expected);
});
