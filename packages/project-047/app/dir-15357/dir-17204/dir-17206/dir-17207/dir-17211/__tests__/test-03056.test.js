const leaf = require('./test-03056.leaf');

test('test-03056', () => {
  const expected = 'test-03056';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
