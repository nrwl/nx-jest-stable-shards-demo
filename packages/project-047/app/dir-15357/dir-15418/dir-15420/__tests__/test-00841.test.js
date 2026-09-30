const leaf = require('./test-00841.leaf');

test('test-00841', () => {
  const expected = 'test-00841';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
