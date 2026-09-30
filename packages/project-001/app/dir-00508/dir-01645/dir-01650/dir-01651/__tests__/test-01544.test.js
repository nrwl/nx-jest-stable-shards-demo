const leaf = require('./test-01544.leaf');

test('test-01544', () => {
  const expected = 'test-01544';
  burn(2057);
  expect(leaf.value).toBe(expected);
});
