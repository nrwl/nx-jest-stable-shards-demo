const leaf = require('./test-00031.leaf');

test('test-00031', () => {
  const expected = 'test-00031';
  burn(30048);
  expect(leaf.value).toBe(expected);
});
