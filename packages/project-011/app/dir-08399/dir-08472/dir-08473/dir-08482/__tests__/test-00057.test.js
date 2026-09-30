const leaf = require('./test-00057.leaf');

test('test-00057', () => {
  const expected = 'test-00057';
  burn(8456);
  expect(leaf.value).toBe(expected);
});
