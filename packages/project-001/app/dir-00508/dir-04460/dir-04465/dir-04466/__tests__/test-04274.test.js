const leaf = require('./test-04274.leaf');

test('test-04274', () => {
  const expected = 'test-04274';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
