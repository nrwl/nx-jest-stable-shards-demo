const leaf = require('./test-00008.leaf');

test('test-00008', () => {
  const expected = 'test-00008';
  burn(28694);
  expect(leaf.value).toBe(expected);
});
