const leaf = require('./test-01757.leaf');

test('test-01757', () => {
  const expected = 'test-01757';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
