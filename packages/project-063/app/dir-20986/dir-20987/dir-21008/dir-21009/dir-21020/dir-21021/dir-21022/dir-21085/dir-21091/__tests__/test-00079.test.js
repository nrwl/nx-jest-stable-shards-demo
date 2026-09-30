const leaf = require('./test-00079.leaf');

test('test-00079', () => {
  const expected = 'test-00079';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
