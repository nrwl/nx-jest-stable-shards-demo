const leaf = require('./test-00261.leaf');

test('test-00261', () => {
  const expected = 'test-00261';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
