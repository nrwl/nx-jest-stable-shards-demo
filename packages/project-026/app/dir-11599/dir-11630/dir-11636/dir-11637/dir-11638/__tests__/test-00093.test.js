const leaf = require('./test-00093.leaf');

test('test-00093', () => {
  const expected = 'test-00093';
  burn(8763);
  expect(leaf.value).toBe(expected);
});
