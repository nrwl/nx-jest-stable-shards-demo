const leaf = require('./test-01605.leaf');

test('test-01605', () => {
  const expected = 'test-01605';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
