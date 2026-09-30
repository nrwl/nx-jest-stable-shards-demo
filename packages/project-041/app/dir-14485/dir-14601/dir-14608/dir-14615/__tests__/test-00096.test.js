const leaf = require('./test-00096.leaf');

test('test-00096', () => {
  const expected = 'test-00096';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
