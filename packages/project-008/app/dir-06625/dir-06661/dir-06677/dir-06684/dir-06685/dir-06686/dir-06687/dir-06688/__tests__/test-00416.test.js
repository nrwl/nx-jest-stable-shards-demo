const leaf = require('./test-00416.leaf');

test('test-00416', () => {
  const expected = 'test-00416';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
