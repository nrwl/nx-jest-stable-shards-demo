const leaf = require('./test-03438.leaf');

test('test-03438', () => {
  const expected = 'test-03438';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
