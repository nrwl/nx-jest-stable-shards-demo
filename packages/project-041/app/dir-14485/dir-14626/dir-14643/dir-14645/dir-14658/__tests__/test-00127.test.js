const leaf = require('./test-00127.leaf');

test('test-00127', () => {
  const expected = 'test-00127';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
