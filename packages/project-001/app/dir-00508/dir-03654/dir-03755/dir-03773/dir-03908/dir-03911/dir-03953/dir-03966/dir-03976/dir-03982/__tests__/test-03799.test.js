const leaf = require('./test-03799.leaf');

test('test-03799', () => {
  const expected = 'test-03799';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
