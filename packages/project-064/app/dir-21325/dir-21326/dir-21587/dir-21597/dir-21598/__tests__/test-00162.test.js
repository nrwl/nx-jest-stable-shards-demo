const leaf = require('./test-00162.leaf');

test('test-00162', () => {
  const expected = 'test-00162';
  burn(5970);
  expect(leaf.value).toBe(expected);
});
