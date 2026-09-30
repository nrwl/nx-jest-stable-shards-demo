const leaf = require('./test-01840.leaf');

test('test-01840', () => {
  const expected = 'test-01840';
  burn(1626);
  expect(leaf.value).toBe(expected);
});
