const leaf = require('./test-00023.leaf');

test('test-00023', () => {
  const expected = 'test-00023';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
