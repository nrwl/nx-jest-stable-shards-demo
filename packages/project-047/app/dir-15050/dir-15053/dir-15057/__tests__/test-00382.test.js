const leaf = require('./test-00382.leaf');

test('test-00382', () => {
  const expected = 'test-00382';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
