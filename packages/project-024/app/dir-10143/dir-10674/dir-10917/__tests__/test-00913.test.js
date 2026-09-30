const leaf = require('./test-00913.leaf');

test('test-00913', () => {
  const expected = 'test-00913';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
