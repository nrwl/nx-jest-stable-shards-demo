const leaf = require('./test-00359.leaf');

test('test-00359', () => {
  const expected = 'test-00359';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
