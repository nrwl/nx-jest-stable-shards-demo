const leaf = require('./test-00047.leaf');

test('test-00047', () => {
  const expected = 'test-00047';
  burn(33189);
  expect(leaf.value).toBe(expected);
});
