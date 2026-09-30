const leaf = require('./test-03591.leaf');

test('test-03591', () => {
  const expected = 'test-03591';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
