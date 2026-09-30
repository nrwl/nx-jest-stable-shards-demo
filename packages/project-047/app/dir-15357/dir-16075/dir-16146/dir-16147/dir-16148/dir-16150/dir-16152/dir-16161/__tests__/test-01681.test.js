const leaf = require('./test-01681.leaf');

test('test-01681', () => {
  const expected = 'test-01681';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
