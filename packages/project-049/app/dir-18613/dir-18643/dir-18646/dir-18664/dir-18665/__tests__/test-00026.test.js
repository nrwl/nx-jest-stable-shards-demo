const leaf = require('./test-00026.leaf');

test('test-00026', () => {
  const expected = 'test-00026';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
