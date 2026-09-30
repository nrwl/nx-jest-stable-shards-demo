const leaf = require('./test-00248.leaf');

test('test-00248', () => {
  const expected = 'test-00248';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
