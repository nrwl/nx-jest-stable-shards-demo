const leaf = require('./test-03562.leaf');

test('test-03562', () => {
  const expected = 'test-03562';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
