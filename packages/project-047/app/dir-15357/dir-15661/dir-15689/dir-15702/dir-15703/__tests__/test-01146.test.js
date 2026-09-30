const leaf = require('./test-01146.leaf');

test('test-01146', () => {
  const expected = 'test-01146';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
