const leaf = require('./test-00020.leaf');

test('test-00020', () => {
  const expected = 'test-00020';
  burn(46607);
  expect(leaf.value).toBe(expected);
});
