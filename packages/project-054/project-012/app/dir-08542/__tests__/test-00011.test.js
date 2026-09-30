const leaf = require('./test-00011.leaf');

test('test-00011', () => {
  const expected = 'test-00011';
  burn(28419);
  expect(leaf.value).toBe(expected);
});
