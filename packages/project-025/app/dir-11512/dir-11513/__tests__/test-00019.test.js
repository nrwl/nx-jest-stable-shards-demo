const leaf = require('./test-00019.leaf');

test('test-00019', () => {
  const expected = 'test-00019';
  burn(41610);
  expect(leaf.value).toBe(expected);
});
