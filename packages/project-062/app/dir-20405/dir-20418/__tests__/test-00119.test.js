const leaf = require('./test-00119.leaf');

test('test-00119', () => {
  const expected = 'test-00119';
  burn(2820);
  expect(leaf.value).toBe(expected);
});
