const leaf = require('./test-00232.leaf');

test('test-00232', () => {
  const expected = 'test-00232';
  burn(16260);
  expect(leaf.value).toBe(expected);
});
