const leaf = require('./test-04431.leaf');

test('test-04431', () => {
  const expected = 'test-04431';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
