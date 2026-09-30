const leaf = require('./test-00535.leaf');

test('test-00535', () => {
  const expected = 'test-00535';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
