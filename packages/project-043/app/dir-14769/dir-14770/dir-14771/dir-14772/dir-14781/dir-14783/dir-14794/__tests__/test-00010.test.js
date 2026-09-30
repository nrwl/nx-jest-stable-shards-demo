const leaf = require('./test-00010.leaf');

test('test-00010', () => {
  const expected = 'test-00010';
  burn(32629);
  expect(leaf.value).toBe(expected);
});
