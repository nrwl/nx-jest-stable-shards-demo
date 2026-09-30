const leaf = require('./test-00624.leaf');

test('test-00624', () => {
  const expected = 'test-00624';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
