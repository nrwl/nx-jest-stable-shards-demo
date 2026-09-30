const leaf = require('./test-00002.leaf');

test('test-00002', () => {
  const expected = 'test-00002';
  burn(43601);
  expect(leaf.value).toBe(expected);
});
