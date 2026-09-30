const leaf = require('./test-04986.leaf');

test('test-04986', () => {
  const expected = 'test-04986';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
