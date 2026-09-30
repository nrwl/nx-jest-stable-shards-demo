const leaf = require('./test-00660.leaf');

test('test-00660', () => {
  const expected = 'test-00660';
  burn(5428);
  expect(leaf.value).toBe(expected);
});
