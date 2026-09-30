const leaf = require('./test-00115.leaf');

test('test-00115', () => {
  const expected = 'test-00115';
  burn(4414);
  expect(leaf.value).toBe(expected);
});
