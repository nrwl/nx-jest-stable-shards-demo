const leaf = require('./test-00306.leaf');

test('test-00306', () => {
  const expected = 'test-00306';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
