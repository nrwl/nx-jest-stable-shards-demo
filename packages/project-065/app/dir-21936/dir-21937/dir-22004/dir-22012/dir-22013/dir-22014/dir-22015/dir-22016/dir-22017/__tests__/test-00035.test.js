const leaf = require('./test-00035.leaf');

test('test-00035', () => {
  const expected = 'test-00035';
  burn(26251);
  expect(leaf.value).toBe(expected);
});
