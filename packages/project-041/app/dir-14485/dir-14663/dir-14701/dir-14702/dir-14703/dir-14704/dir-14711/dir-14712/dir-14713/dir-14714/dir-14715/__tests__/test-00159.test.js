const leaf = require('./test-00159.leaf');

test('test-00159', () => {
  const expected = 'test-00159';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
