const leaf = require('./test-00416.leaf');

test('test-00416', () => {
  const expected = 'test-00416';
  burn(16876);
  expect(leaf.value).toBe(expected);
});
