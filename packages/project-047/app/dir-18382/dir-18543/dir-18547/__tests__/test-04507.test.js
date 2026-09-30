const leaf = require('./test-04507.leaf');

test('test-04507', () => {
  const expected = 'test-04507';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
