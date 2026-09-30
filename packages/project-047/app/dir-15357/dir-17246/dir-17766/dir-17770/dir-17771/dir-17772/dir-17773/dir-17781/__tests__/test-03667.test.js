const leaf = require('./test-03667.leaf');

test('test-03667', () => {
  const expected = 'test-03667';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
