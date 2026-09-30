const leaf = require('./test-03621.leaf');

test('test-03621', () => {
  const expected = 'test-03621';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
