const leaf = require('./test-00098.leaf');

test('test-00098', () => {
  const expected = 'test-00098';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
