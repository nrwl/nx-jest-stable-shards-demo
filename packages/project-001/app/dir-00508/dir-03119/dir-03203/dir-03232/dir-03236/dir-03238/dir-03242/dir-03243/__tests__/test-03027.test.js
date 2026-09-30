const leaf = require('./test-03027.leaf');

test('test-03027', () => {
  const expected = 'test-03027';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
