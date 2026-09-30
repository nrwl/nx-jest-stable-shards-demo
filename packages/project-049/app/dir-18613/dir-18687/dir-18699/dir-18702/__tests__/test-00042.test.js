const leaf = require('./test-00042.leaf');

test('test-00042', () => {
  const expected = 'test-00042';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
