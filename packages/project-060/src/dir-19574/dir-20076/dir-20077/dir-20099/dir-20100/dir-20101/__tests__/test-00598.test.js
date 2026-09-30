const leaf = require('./test-00598.leaf');

test('test-00598', () => {
  const expected = 'test-00598';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
