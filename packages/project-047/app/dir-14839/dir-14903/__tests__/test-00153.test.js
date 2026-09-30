const leaf = require('./test-00153.leaf');

test('test-00153', () => {
  const expected = 'test-00153';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
