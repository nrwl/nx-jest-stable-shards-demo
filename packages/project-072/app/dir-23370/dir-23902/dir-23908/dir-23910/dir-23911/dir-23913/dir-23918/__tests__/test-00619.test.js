const leaf = require('./test-00619.leaf');

test('test-00619', () => {
  const expected = 'test-00619';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
