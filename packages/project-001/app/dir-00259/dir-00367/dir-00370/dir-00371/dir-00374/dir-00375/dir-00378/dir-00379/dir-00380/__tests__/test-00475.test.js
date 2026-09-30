const leaf = require('./test-00475.leaf');

test('test-00475', () => {
  const expected = 'test-00475';
  burn(2117);
  expect(leaf.value).toBe(expected);
});
