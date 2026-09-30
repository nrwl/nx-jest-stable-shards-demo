const leaf = require('./test-00238.leaf');

test('test-00238', () => {
  const expected = 'test-00238';
  burn(2164);
  expect(leaf.value).toBe(expected);
});
