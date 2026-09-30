const leaf = require('./test-00002.leaf');

test('test-00002', () => {
  const expected = 'test-00002';
  burn(34405);
  expect(leaf.value).toBe(expected);
});
