const leaf = require('./test-01306.leaf');

test('test-01306', () => {
  const expected = 'test-01306';
  burn(5143);
  expect(leaf.value).toBe(expected);
});
