const leaf = require('./test-00179.leaf');

test('test-00179', () => {
  const expected = 'test-00179';
  burn(5965);
  expect(leaf.value).toBe(expected);
});
