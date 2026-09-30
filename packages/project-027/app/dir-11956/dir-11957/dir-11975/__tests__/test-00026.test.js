const leaf = require('./test-00026.leaf');

test('test-00026', () => {
  const expected = 'test-00026';
  burn(29983);
  expect(leaf.value).toBe(expected);
});
