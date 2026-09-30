const leaf = require('./test-00535.leaf');

test('test-00535', () => {
  const expected = 'test-00535';
  burn(2805);
  expect(leaf.value).toBe(expected);
});
