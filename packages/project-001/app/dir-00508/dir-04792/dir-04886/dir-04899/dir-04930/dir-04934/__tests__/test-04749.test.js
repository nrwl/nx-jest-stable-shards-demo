const leaf = require('./test-04749.leaf');

test('test-04749', () => {
  const expected = 'test-04749';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
