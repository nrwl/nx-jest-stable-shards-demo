const leaf = require('./test-00713.leaf');

test('test-00713', () => {
  const expected = 'test-00713';
  burn(2424);
  expect(leaf.value).toBe(expected);
});
