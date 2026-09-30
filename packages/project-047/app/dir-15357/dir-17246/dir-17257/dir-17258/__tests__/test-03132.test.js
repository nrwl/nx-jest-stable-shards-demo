const leaf = require('./test-03132.leaf');

test('test-03132', () => {
  const expected = 'test-03132';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
