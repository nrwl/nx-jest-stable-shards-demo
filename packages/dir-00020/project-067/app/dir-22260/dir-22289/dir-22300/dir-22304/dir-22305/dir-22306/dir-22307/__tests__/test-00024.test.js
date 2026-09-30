const leaf = require('./test-00024.leaf');

test('test-00024', () => {
  const expected = 'test-00024';
  burn(28741);
  expect(leaf.value).toBe(expected);
});
