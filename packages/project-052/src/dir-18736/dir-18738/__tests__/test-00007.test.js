const leaf = require('./test-00007.leaf');

test('test-00007', () => {
  const expected = 'test-00007';
  burn(27829);
  expect(leaf.value).toBe(expected);
});
