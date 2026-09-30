const leaf = require('./test-00159.leaf');

test('test-00159', () => {
  const expected = 'test-00159';
  burn(10727);
  expect(leaf.value).toBe(expected);
});
