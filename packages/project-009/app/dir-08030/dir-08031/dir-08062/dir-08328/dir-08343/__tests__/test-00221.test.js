const leaf = require('./test-00221.leaf');

test('test-00221', () => {
  const expected = 'test-00221';
  burn(2826);
  expect(leaf.value).toBe(expected);
});
