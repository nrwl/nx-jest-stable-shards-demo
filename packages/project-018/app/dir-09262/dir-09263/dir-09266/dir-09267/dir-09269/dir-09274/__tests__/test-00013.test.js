const leaf = require('./test-00013.leaf');

test('test-00013', () => {
  const expected = 'test-00013';
  burn(31863);
  expect(leaf.value).toBe(expected);
});
