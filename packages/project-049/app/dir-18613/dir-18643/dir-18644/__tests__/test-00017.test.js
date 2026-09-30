const leaf = require('./test-00017.leaf');

test('test-00017', () => {
  const expected = 'test-00017';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
