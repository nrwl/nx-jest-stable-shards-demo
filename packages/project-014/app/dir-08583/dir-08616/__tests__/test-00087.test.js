const leaf = require('./test-00087.leaf');

test('test-00087', () => {
  const expected = 'test-00087';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
