const leaf = require('./test-00459.leaf');

test('test-00459', () => {
  const expected = 'test-00459';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
