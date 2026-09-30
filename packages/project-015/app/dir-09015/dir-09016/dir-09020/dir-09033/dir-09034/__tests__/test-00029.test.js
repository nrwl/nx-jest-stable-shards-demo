const leaf = require('./test-00029.leaf');

test('test-00029', () => {
  const expected = 'test-00029';
  burn(53218);
  expect(leaf.value).toBe(expected);
});
