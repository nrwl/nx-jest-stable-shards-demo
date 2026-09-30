const leaf = require('./test-00030.leaf');

test('test-00030', () => {
  const expected = 'test-00030';
  burn(30748);
  expect(leaf.value).toBe(expected);
});
