const leaf = require('./test-00004.leaf');

test('test-00004', () => {
  const expected = 'test-00004';
  burn(28895);
  expect(leaf.value).toBe(expected);
});
