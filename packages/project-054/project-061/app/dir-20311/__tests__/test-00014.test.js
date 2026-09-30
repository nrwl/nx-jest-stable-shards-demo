const leaf = require('./test-00014.leaf');

test('test-00014', () => {
  const expected = 'test-00014';
  burn(7503);
  expect(leaf.value).toBe(expected);
});
