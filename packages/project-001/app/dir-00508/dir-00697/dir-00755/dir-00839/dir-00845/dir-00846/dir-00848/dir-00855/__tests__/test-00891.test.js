const leaf = require('./test-00891.leaf');

test('test-00891', () => {
  const expected = 'test-00891';
  burn(2108);
  expect(leaf.value).toBe(expected);
});
