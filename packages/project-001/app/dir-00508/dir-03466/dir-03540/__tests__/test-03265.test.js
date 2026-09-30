const leaf = require('./test-03265.leaf');

test('test-03265', () => {
  const expected = 'test-03265';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
