const leaf = require('./test-00007.leaf');

test('test-00007', () => {
  const expected = 'test-00007';
  burn(23492);
  expect(leaf.value).toBe(expected);
});
