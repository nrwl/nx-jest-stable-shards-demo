const leaf = require('./test-04354.leaf');

test('test-04354', () => {
  const expected = 'test-04354';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
