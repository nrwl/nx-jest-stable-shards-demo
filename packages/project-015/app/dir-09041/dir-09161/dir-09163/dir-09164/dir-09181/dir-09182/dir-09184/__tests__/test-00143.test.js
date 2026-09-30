const leaf = require('./test-00143.leaf');

test('test-00143', () => {
  const expected = 'test-00143';
  burn(6432);
  expect(leaf.value).toBe(expected);
});
