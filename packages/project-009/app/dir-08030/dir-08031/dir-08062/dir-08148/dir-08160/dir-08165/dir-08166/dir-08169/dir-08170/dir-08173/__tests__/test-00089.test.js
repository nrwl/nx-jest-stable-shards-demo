const leaf = require('./test-00089.leaf');

test('test-00089', () => {
  const expected = 'test-00089';
  burn(2592);
  expect(leaf.value).toBe(expected);
});
