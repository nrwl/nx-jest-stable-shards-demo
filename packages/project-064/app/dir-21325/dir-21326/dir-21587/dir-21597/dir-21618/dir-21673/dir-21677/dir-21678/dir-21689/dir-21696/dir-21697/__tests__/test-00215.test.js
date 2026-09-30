const leaf = require('./test-00215.leaf');

test('test-00215', () => {
  const expected = 'test-00215';
  burn(19959);
  expect(leaf.value).toBe(expected);
});
