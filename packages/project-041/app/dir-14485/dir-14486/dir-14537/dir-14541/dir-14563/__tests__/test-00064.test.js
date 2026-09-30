const leaf = require('./test-00064.leaf');

test('test-00064', () => {
  const expected = 'test-00064';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
