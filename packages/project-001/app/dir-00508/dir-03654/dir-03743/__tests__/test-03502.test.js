const leaf = require('./test-03502.leaf');

test('test-03502', () => {
  const expected = 'test-03502';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
