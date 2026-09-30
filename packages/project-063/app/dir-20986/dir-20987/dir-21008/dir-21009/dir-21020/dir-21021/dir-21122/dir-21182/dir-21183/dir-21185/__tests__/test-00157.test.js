const leaf = require('./test-00157.leaf');

test('test-00157', () => {
  const expected = 'test-00157';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
