const leaf = require('./test-00356.leaf');

test('test-00356', () => {
  const expected = 'test-00356';
  burn(7291);
  expect(leaf.value).toBe(expected);
});
