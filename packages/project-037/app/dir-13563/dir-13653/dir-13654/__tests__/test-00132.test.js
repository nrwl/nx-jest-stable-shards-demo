const leaf = require('./test-00132.leaf');

test('test-00132', () => {
  const expected = 'test-00132';
  burn(3532);
  expect(leaf.value).toBe(expected);
});
