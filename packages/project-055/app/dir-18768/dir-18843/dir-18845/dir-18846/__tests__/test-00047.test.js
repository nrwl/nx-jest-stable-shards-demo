const leaf = require('./test-00047.leaf');

test('test-00047', () => {
  const expected = 'test-00047';
  burn(3022);
  expect(leaf.value).toBe(expected);
});
