const leaf = require('./test-00196.leaf');

test('test-00196', () => {
  const expected = 'test-00196';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
