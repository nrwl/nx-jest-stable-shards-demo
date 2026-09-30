const leaf = require('./test-03087.leaf');

test('test-03087', () => {
  const expected = 'test-03087';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
