const leaf = require('./test-01299.leaf');

test('test-01299', () => {
  const expected = 'test-01299';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
