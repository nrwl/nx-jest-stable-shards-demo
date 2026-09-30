const leaf = require('./test-00396.leaf');

test('test-00396', () => {
  const expected = 'test-00396';
  burn(3969);
  expect(leaf.value).toBe(expected);
});
