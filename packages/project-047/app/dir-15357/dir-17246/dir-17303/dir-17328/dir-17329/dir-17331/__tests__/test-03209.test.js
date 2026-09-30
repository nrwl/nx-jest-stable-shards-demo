const leaf = require('./test-03209.leaf');

test('test-03209', () => {
  const expected = 'test-03209';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
